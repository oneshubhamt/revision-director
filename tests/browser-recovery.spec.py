from helpers.browser_harness import run_python_scenarios

run_python_scenarios([
    "persistent-active-retrieval.py",
    "ownership-storage-health.py",
    "hostile-recovery.py",
    "indexeddb-durability.py",
])
