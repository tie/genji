const { execFileSync } = require('child_process')
const fs = require('fs')
const https = require('https')
const path = require('path')

module.exports = async ({ core }) => {
  // Get Go release tags.

  const releaseTags = execFileSync('go', [
    'list', '-f',
    '{{range context.ReleaseTags}}{{println .}}{{end}}',
    'runtime',
  ]).toString().trim().split(/\r?\n/)

  // Set up Go environment variables.

  const [goos, goarch] = process.env.platform.split('/')
  core.exportVariable('GOOS', goos)
  core.exportVariable('GOARCH', goarch)

  core.exportVariable('GOFLAGS', '-race -trimpath -mod=readonly')

  // Enable Cgo explicitly for -race flag since we are cross compiling.

  core.exportVariable('CGO_ENABLED', '1')
  core.exportVariable('CC', 'powerpc64le-linux-gnu-gcc')

  // Export cache paths for further steps.

  const buildCache = execFileSync('go', ['env', 'GOCACHE']).toString().trim()
  const modCache = (() => {
    if (releaseTags.includes('go1.15')) {
      return execFileSync('go', ['env', 'GOMODCACHE']).toString().trim()
    } else {
      const gopath = execFileSync('go', ['env', 'GOPATH']).toString().trim()
      return path.join(gopath, 'pkg', 'mod')
    }
  })()

  core.exportVariable('GOCACHE', buildCache)
  core.exportVariable('GOMODCACHE', modCache)

  await core.group('Run apt install', async () => {
    // Install QEMU and GCC cross compiler.

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

  // Pass target sysroot and program loader path to QEMU.

  core.exportVariable('QEMU_LD_PREFIX', '/usr/powerpc64le-linux-gnu')

  // Prebuilt Go releases do not contain race detector runtime for non-host architectures.
  // Download syso object for the latest known **major** release and place it in GOROOT.

  await core.group('Download race detector runtime', async () => {
    const sysoRef = (() => {
      // See https://github.com/golang/go/issues/42080
      if (releaseTags.includes('go1.15') && goos == 'linux' && goarch == 'ppc64le') {
        return 'go1.15rc1'
      }

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
      // Unknown format, default to latest release tag.
      return releaseTags[releaseTags.length-1]
    })()

    const goroot = execFileSync('go', ['env', 'GOROOT']).toString().trim()

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
}
