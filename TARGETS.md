## Targets

Generally, Genji should compile and run on any target supported by Go compiler (gc). To ensure that changes and new features do not introduce regressions on some platforms, we run tests for each target as part of our CI system.

### Tests matrix

| <sub>GOARCH</sub><sup>GOOS</sup> | linux | windows | darwin | js |
|---------------------------------:|:-----:|:-------:|:------:|:--:|
|                              386 |   ✓   |    ✓    |        |    |
|                            amd64 |   ✓   |    ✓    |    ✓   |    |
|                              arm |   ○   |    ?    |        |    |
|                            arm64 |   ○   |         |    ?   |    |
|                             mips |   ?   |         |        |    |
|                           mips64 |   ?   |         |        |    |
|                         mips64le |   ?   |         |        |    |
|                           mipsle |   ?   |         |        |    |
|                            ppc64 |   ○   |         |        |    |
|                          ppc64le |   ○   |         |        |    |
|                          riscv64 |   ○   |         |        |    |
|                            s390x |   ○   |         |        |    |
|                             wasm |       |         |        |  ? |

- “✓”: supported; tests are run on CI for each change.
- “○”: partial support; tests are run under QEMU user mode emulation.
- “?”: unknown; no tests are run on CI.
- Unlisted: same as “?”.
- Empty cell: unsupported GOOS/GOARCH pair.

### Race detector matrix

Tests are run with [race detector](https://golang.org/doc/articles/race_detector.html) enabled when possible.
On systems where race detector is not available, we explicitly [pass `-d=checkptr` flag](https://github.com/golang/go/issues/34964) to the Go compiler.

| <sub>GOARCH</sub><sup>GOOS</sup> |                  linux                  | darwin | windows | freebsd | netbsd |
|---------------------------------:|:---------------------------------------:|:------:|:-------:|:-------:|:------:|
|                            amd64 |                    ✓                    |    ✓   |    ✓    |    ?    |    ?   |
|                            arm64 | ✗<a href="#f1" id="a1"><sup>1</sup></a> |        |         |         |        |
|                          ppc64le | ✓<a href="#f2" id="a2"><sup>1</sup></a> |        |         |         |        |

<a id="f1" href="#a1"><sup>1</sup></a>While Go race detector runtime supports linux/arm64, ThreadSanitizer requires 48-bit VMA. QEMU user space emulation on top of ubuntu-20.04 runner had 39-bit VMA so we couldn’t run tests with -race flag.

<a id="f2" href="#a2"><sup>2</sup></a>Coverage report is empty when running tests with race detector (Cgo) on linux/ppc64le.
