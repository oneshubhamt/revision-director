"""Wall-clock measurements for named browser subjourneys."""
from time import perf_counter


def timed(name, action, *args):
    started = perf_counter()
    try:
        return action(*args)
    finally:
        print(f"QA_SCENARIO {name} {perf_counter() - started:.3f}s", flush=True)
