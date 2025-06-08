# minuteDebug

A lean, fast and smart VS Code debugger extension for embedded development. Focused on doing as much as possible with as little as possible.

## Features

- semi-automatic configuration - whenever possible, doesn't make you specify the obvious but uses reasonable defaults
    - at the same time, most settings can be overridden at multiple levels (extension configuration, launch configuration, etc.)
- standard debugger integration
    - local and global variables
    - watch expressions
    - call stack
    - breakpoints
      - including Cortex-M exceptions (reset & fault)
    - debug console REPL
- raw register values are included in debugger variables
- [SVD] support for viewing of peripheral registers
    - SVDs are automatically loaded from the [CMSIS-SVD Repository]
- limited [CoreSight] support (ITM printf-style output on channel 0)
- smart program loading - doesn't push the same executable to the target device on repeated runs, reducing FLASH wear and startup time

## Supported devices

### Probes

- currently, only the [Black Magic Probe] is suported, including SWO trace output

### SMUs

- very limited support for STLINK-V3PWR (just power on/off)

## Sponsoring

If you like this project, don't hesitate to [sponsor] continued development. Our goal is to provide professional grade tooling, while keeping all the projects completely open, sustained only by sponsorships.

Don't hesitate to get in touch regarding any specific requests such as device support, ideas for new features, etc.

[Black Magic Probe]: https://black-magic.org/
[SVD]: https://arm-software.github.io/CMSIS_5/SVD/html/svd_Format_pg.html
[CMSIS-SVD Repository]: https://github.com/cmsis-svd/cmsis-svd-data
[CoreSight]: https://developer.arm.com/documentation/ddi0314
[sponsor]: https://github.com/sponsor/minuteos
