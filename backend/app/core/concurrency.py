import asyncio
import functools
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, TypeVar, Any

logger = logging.getLogger("cyclode.core.concurrency")

T = TypeVar("T")

# Dedicated thread pool for non-blocking disk I/O, git operations, and external system processes
# Prevents Python's single-threaded asyncio event loop from stalling during deep repository inspections
_IO_EXECUTOR = ThreadPoolExecutor(max_workers=32, thread_name_prefix="cyclode-io-worker")


async def run_io_blocking(func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """
    Executes a blocking, synchronous function (e.g. filesystem walks, file reading/writing,
    synchronous git subprocesses) on the dedicated I/O threadpool.
    """
    loop = asyncio.get_running_loop()
    if kwargs:
        pfunc = functools.partial(func, *args, **kwargs)
        return await loop.run_in_executor(_IO_EXECUTOR, pfunc)
    return await loop.run_in_executor(_IO_EXECUTOR, func, *args)
