import argparse
import os
import shutil
import csv
from combiner import Combiner

parser = argparse.ArgumentParser()
parser.add_argument('--workdir', required=True)
parser.add_argument('--out', default='parsed.csv')
args = parser.parse_args()

orig_cwd = os.getcwd()
workdir = os.path.abspath(args.workdir)
out_path = os.path.abspath(args.out)

# Combiner expects files in latest/ under repo root; we'll copy files into repo ./latest then run Combiner.generate()
repo_latest = os.path.join(orig_cwd, 'latest')
# ensure clean repo latest
if os.path.exists(repo_latest):
    shutil.rmtree(repo_latest)
shutil.copytree(workdir, repo_latest)

try:
    # instantiate Combiner to operate on this workdir and produce isolated out_file
    comb = Combiner(workdir=repo_latest, out_file=out_path)
    comb.generate()
    # Combiner.prepare_csv will have created the out_path; verify and exit accordingly
    if not os.path.exists(out_path):
        # nothing produced
        exit(1)
    exit(0)
finally:
    # cleanup repo latest to avoid cross-job contamination
    if os.path.exists(repo_latest):
        shutil.rmtree(repo_latest)
    os.chdir(orig_cwd)
