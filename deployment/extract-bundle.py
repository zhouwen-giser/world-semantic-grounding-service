#!/usr/bin/env python3
"""Verify an inventoried source archive before extracting any files."""
import argparse
from pathlib import Path
from bundle_common import extract, read_archive, verify_tree

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['verify', 'verify-tree', 'extract'])
parser.add_argument('archive', type=Path)
parser.add_argument('destination', nargs='?', type=Path)
args = parser.parse_args()
if args.command == 'verify':
    print(read_archive(args.archive)[0])
elif args.destination is None:
    parser.error('extract/verify-tree requires a destination')
elif args.command == 'verify-tree':
    print(verify_tree(args.archive, args.destination))
else:
    print(extract(args.archive, args.destination))
