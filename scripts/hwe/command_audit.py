"""Recognize actual short-check invocations, excluding quoted report text."""
import pathlib,shlex

def is_lint_invocation(command):
    try:
        args=shlex.split(command)
        if args and pathlib.PurePosixPath(args[0]).name in {'bash','sh'} and '-lc' in args:
            args=shlex.split(args[args.index('-lc')+1])
        if args[:3]==['cd','/work','&&']:args=args[3:]
        return len(args)>=3 and pathlib.PurePosixPath(args[0]).name=='make' and args[1]=='lint' and 'TARGET=baseline' in args[2:]
    except (ValueError,IndexError,TypeError):return False
