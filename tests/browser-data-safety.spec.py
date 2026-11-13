from helpers.browser_harness import run_python_scenarios

run_python_scenarios([
    "planning-large-dataset.py",
    "backup-codec.py",
    "backup-restore-controller.py",
    "data-safety.py",
    "restore-dialog-accessibility.py",
])
