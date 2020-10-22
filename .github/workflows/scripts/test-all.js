const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

module.exports = async ({ core }) => {
  const forEachModule = async (dir, visit) => {
    const dirents = fs.readdirSync(dir, {
      withFileTypes: true,
    })
    dirents.sort((a, b) => {
      if (a.name > b.name) {
        return 1
      }
      if (a.name < b.name) {
        return -1
      }
      return 0
    })
    for (const dirent of dirents) {
      const { name } = dirent

      // Skip paths ignored by Go toolchain.
      if (name.startsWith('.') || name.startsWith('_')) {
        continue
      }
      if (name == 'testdata' || name == 'vendor') {
        continue
      }

      // Check whether we are at the root package.
      if (name == 'go.mod' && dirent.isFile()) {
        await visit(dir)
        continue
      }

      // Descend into subdirectories.
      if (dirent.isDirectory()) {
        forEachModule(path.resolve(dir, name), visit)
      }
    }
  }

  await core.group('Run go env', async () => {
    execFileSync('go', ['env'], {
      stdio: 'inherit',
    })
  })

  await core.group('Run go mod download', async () => {
    return await forEachModule('.', async (dir) => {
      execFileSync('go', ['mod', 'download'], {
        stdio: 'inherit',
        cwd: dir,
      })
    })
  })

  await core.group('Run go test', async () => {
    const [goos, goarch] = execFileSync('go', [
      'env', 'GOOS', 'GOARCH',
    ]).toString().trim().split(/\r?\n/)

    const enableRace = (() => {
      // Tests under QEMU user mode emulation fail with the following error:
      // FATAL: ThreadSanitizer: unsupported VMA range
      // FATAL: Found 39 - Supported 48
      //
      // Note that this may change in the next QEMU release.
      // See https://wiki.qemu.org/ChangeLog/5.2#Arm
      // Though this change seems to be related to system-mode emulation,
      // which we haven’t tested yet.
      if (goos == 'linux' && goarch == 'arm64' && process.env.QEMU_LD_PREFIX != '') {
        delete process.env.CGO_ENABLED
        return false
      }
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

    const args = [
      '-trimpath',
      '-mod=readonly',
      '-coverprofile=coverage.txt',
    ]
    if (enableRace) {
      args.push('-race')
    }
    return await forEachModule('.', async (dir) => {
      try {
        execFileSync('go', ['test', ...args, './...'], {
          stdio: 'inherit',
          cwd: dir,
        })
      } catch (err) {
        core.setFailed(`test ${dir}: ${err}`)
      }
    })
  })
}
