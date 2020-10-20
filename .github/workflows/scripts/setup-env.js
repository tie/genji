const { execFileSync } = require('child_process')
const fs = require('fs')
const https = require('https')
const path = require('path')

module.exports = async ({ core }) => {
  const {
    goos, goarch, goarm,
    goroot, gopath,
    releaseTags,
    releaseRef,
    buildCache,
    modCache,
  } = await core.group('Gather environment information', async () => {
    const [goos, goarch, goarm] = process.env.platform.split('/')
    core.info(`Setting up for GOOS=${goos} GOARCH=${goarch}` + (goarm ? ' GOARM='+goarm : ''))

    // Get some standard paths.
    const [goroot, gopath] = execFileSync('go', [
      'env', 'GOROOT', 'GOPATH',
    ]).toString().trim().split(/\r?\n/)

    // Get Go release tags.
    const releaseTags = execFileSync('go', [
      'list', '-f',
      '{{range context.ReleaseTags}}{{println .}}{{end}}',
      'runtime',
    ]).toString().trim().split(/\r?\n/)

    // Get Git tag or sha for Go release.
    const releaseRef = (() => {
      const versionFields = execFileSync('go', [
        'version',
      ]).toString().trim().split(' ').slice(2, -1)

      // ['go1.14.9']
      if (versionFields.length == 1) {
        return versionFields[0]
      }
      // ['devel', '+66e66e7113', 'Sun', 'Sep', '13', '19:17:09', '2020', '+0000']
      if (versionFields.length == 8) {
        return versionFields[1].slice(1)
      }
      // Unexpected format, default to latest release tag.
      return releaseTags[releaseTags.length-1]
    })()

    // Get Go cache paths.
    const buildCache = execFileSync('go', ['env', 'GOCACHE']).toString().trim()
    const modCache = (() => {
      if (releaseTags.includes('go1.15')) {
        return execFileSync('go', ['env', 'GOMODCACHE']).toString().trim()
      } else {
        return path.join(gopath, 'pkg', 'mod')
      }
    })()

    return {
      goos, goarch, goarm,
      goroot, gopath,
      releaseTags,
      releaseRef,
      buildCache,
      modCache,
    }
  })

  await core.group('Run apt install', async () => {
    // Install QEMU (and GCC cross compiler).
    execFileSync('sudo', [
      'apt-get', 'install',
      '--no-install-recommends', '-y',
      'qemu-user',
      'qemu-user-binfmt',
      'gcc-powerpc64le-linux-gnu',
      'libc6-dev-ppc64el-cross',
      'libtsan0-ppc64el-cross',
    ], {
      stdio: 'inherit',
    })
  })

  await core.group('Download race detector runtime', async () => {
    // Prebuilt Go releases do not contain race detector runtime for non-host architectures.
    // Download syso object from Git repo and place it in GOROOT.

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
        return
      }
      const dest = fs.createWriteStream(sysoDest)
      resp.pipe(dest)
    }).on('error', (err) => {
      core.setFailed(`download race runtime: ${err}`)
    })
  })

  await core.group('Export environment variables', async () => {
    // Set up Go flags.
    core.exportVariable('GOFLAGS', '-race -trimpath -mod=readonly')

    // Set up Go cross compilation.
    core.exportVariable('GOOS', goos)
    core.exportVariable('GOARCH', goarch)
    if (goarm) {
      core.exportVariable('GOARM', goarm)
    }

    // Enable Cgo explicitly for -race flag since we are cross compiling.
    core.exportVariable('CGO_ENABLED', '1')
    core.exportVariable('CC', 'powerpc64le-linux-gnu-gcc')

    // Export cache paths for actions/cache step.
    core.exportVariable('GOCACHE', buildCache)
    core.exportVariable('GOMODCACHE', modCache)

    // Pass target sysroot and program loader path to QEMU.
    core.exportVariable('QEMU_LD_PREFIX', '/usr/powerpc64le-linux-gnu')
  })
}
