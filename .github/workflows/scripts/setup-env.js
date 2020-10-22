const { execFileSync } = require('child_process')
const fs = require('fs')
const https = require('https')
const path = require('path')

module.exports = async ({ core }) => {
  const {
    distos, distarch,
    goos, goarch, goarm,
    goroot, gopath,
    releaseTags,
    releaseRef,
    buildCache,
    modCache,
  } = await core.group('Gather environment information', async () => {
    const [goos, goarch, goarm] = (() => {
      const [goos, goarch] = process.env.target.split('/', 2)
      if (goarch.startsWith('armv')) {
        // We have armv${GOARM} format.
        return [goos, ...goarch.split('v', 2)]
      }
      return [goos, goarch, '']
    })()

    core.info(`Setting up for GOOS=${goos} GOARCH=${goarch} GOARM=${goarm}`)

    const [goroot, gopath] = execFileSync('go', [
      'env', 'GOROOT', 'GOPATH',
    ]).toString().trim().split(/\r?\n/)

    const releaseTags = execFileSync('go', [
      'list', '-f',
      '{{range context.ReleaseTags}}{{println .}}{{end}}',
      'runtime',
    ]).toString().trim().split(/\r?\n/)

    const versionFields = execFileSync('go', [
      'version',
    ]).toString().trim().split(' ')

    const [distos, distarch] = versionFields[versionFields.length-1].split('/')

    // Get Git tag or sha for Go release.
    const releaseRef = (() => {
      const fields = versionFields.slice(2, -1)
      // ['go1.14.9']
      if (fields.length == 1) {
        return fields[0]
      }
      // ['devel', '+66e66e7113', ...]
      if (fields.length == 8) {
        return fields[1]
      }
      // Unexpected format, default to latest release tag.
      return releaseTags[releaseTags.length-1]
    })()

    core.info(`Inferred Go ref ${releaseRef}`)

    const buildCache = execFileSync('go', ['env', 'GOCACHE']).toString().trim()
    const modCache = (() => {
      if (releaseTags.includes('go1.15')) {
        return execFileSync('go', ['env', 'GOMODCACHE']).toString().trim()
      } else {
        return path.join(gopath, 'pkg', 'mod')
      }
    })()

    return {
      distos, distarch,
      goos, goarch, goarm,
      goroot, gopath,
      releaseTags,
      releaseRef,
      buildCache,
      modCache,
    }
  })

  const enableCross = (() => {
    if (distos != 'linux') {
      return false
    }
    if (distarch == 'amd64' && goarch == '386') {
      return false
    }
    return distos != goos || distarch != goarch
  })()

  const enableRace = (() => {
    switch (goos) {
    case 'linux':
      return goarch == 'amd64' || goarch == 'ppc64le' || goarch == 'arm64'
    case 'freebsd':
    case 'netbsd':
    case 'darwin':
    case 'windows':
      return goarch == 'amd64'
    default:
      return false
    }
  })()

  if (enableCross) {
    await core.group('Run apt install', async () => {
      // Install QEMU and C cross compiler.
      const qemu = [
        'qemu-user',
        'qemu-user-binfmt',
      ]
      const cc = enableRace ? [
        'gcc-powerpc64le-linux-gnu',
        'libc6-dev-ppc64el-cross',
        'libtsan0-ppc64el-cross',
      ] : []
      execFileSync('sudo', [
        'apt-get', 'install',
        '--no-install-recommends', '-y',
        ...qemu, ...cc,
      ], {
        stdio: 'inherit',
      })
    })
  }

  // Prebuilt Go releases do not contain race detector runtime for non-host targets.
  if (enableRace && enableCross) {
    await core.group('Download race detector runtime', async () => {
      const sysoRef = (releaseTags.includes('go1.15') && goos == 'linux' && goarch == 'ppc64le')
                    ? 'go1.15rc1' // See https://github.com/golang/go/issues/42080
                    : releaseRef

      const sysoName = `race_${goos}_${goarch}.syso`
      const sysoPath = `src/runtime/race/${sysoName}`
      const sysoDest = `${goroot}/${sysoPath}`
      const sysoURL = `https://raw.githubusercontent.com/golang/go/${sysoRef}/${sysoPath}`

      core.info(`Downloading ${sysoName} to ${sysoDest} from ${sysoURL}`)
      https.get(sysoURL, (resp) => {
        if (resp.statusCode !== 200) {
          core.setFailed(`download race runtime: ${resp.statusCode} ${resp.statusMessage}`)
          process.exit()
        }
        const dest = fs.createWriteStream(sysoDest)
        resp.pipe(dest)
      }).on('error', (err) => {
        core.setFailed(`download race runtime: ${err}`)
        process.exit()
      })
    })
  }

  await core.group('Export environment variables', async () => {
    // Set up Go cross compilation.
    core.exportVariable('GOOS', goos)
    core.exportVariable('GOARCH', goarch)
    core.exportVariable('GOARM', goarm)

    // Enable Cgo explicitly for -race flag if we are cross compiling.
    if (enableCross && enableRace) {
      core.exportVariable('CGO_ENABLED', '1')
      core.exportVariable('CC', 'powerpc64le-linux-gnu-gcc')

      // Pass target sysroot and program loader path to QEMU.
      core.exportVariable('QEMU_LD_PREFIX', '/usr/powerpc64le-linux-gnu')
    }

    // Export cache paths for actions/cache step.
    core.exportVariable('GOCACHE', buildCache)
    core.exportVariable('GOMODCACHE', modCache)
  })
}
