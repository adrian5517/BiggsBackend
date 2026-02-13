import pandas as pd
import numpy as np
import decimal
from decimal import Decimal
import matplotlib.pyplot as plt
import datetime 
import matplotlib.dates as mdates
from bokeh.plotting import figure, show, output_notebook
from bokeh.layouts import row 
from bokeh.palettes import Category20_20
from bokeh.models import HoverTool
from bokeh.models import ColumnDataSource, ranges, LabelSet
import itertools
from pandasbiggs import *
import os
from fetcher import Receive
from combiner import Combiner
import pprint

def clean(directory):
    for filename in os.listdir(directory):
        file_path = os.path.join(directory, filename)
        try:
            if os.path.isfile(file_path) or os.path.islink(file_path):
                os.unlink(file_path)
            elif os.path.isdir(file_path):
                shutil.rmtree(file_path)
        except Exception as e:
            print('Failed to delete %s. Reason: %s' % (file_path, e))

parentDir = os.getcwd()
clean(parentDir + '/latest')
clean(parentDir + '/temp')

csv2023 = CSVProcessor("record2025.csv")

value = 'Amount'
# dateStart = input("Enter start date (YYYY-MM-DD): ")
# dateEnd = input("Enter end date (YYYY-MM-DD): ")
# date_start = datetime.datetime.strptime(dateStart, "%Y-%m-%d")
# # date_start = datetime.datetime.now()
# date_start = (date_start - datetime.timedelta(days=7)).strftime('%Y-%m-%d')
# date_end = datetime.datetime.now().strftime("%Y-%m-%d")
def get_date_input(prompt):
    while True:
        try:
            user_input = input(prompt)
            # Try parsing as datetime (YYYY-MM-DD)
            date_value = datetime.datetime.strptime(user_input, "%Y-%m-%d")
            return date_value
        except ValueError:
            print("❌ Invalid format. Please use YYYY-MM-DD.")

# Get start and end dates
date_start = get_date_input("Enter start date (YYYY-MM-DD): ")
date_end = get_date_input("Enter end date (YYYY-MM-DD): ")
# date_start = datetime.datetime.strptime('2025-08-15', "%Y-%m-%d")
# date_end = datetime.datetime.strptime('2025-08-31', "%Y-%m-%d")

# Validation: start must be before end
if date_start > date_end:
    print("❌ Start date must be before End date.")
else:
    # Example: subtract 7 days from start
    # date_start_adjusted = (date_start - datetime.timedelta(days=7)).strftime("%Y-%m-%d")
    date_start_adjusted = date_start.strftime("%Y-%m-%d")
    date_end_str = date_end.strftime("%Y-%m-%d")

    print("✅ Start date (adjusted):", date_start_adjusted)
    print("✅ End date:", date_end_str)

filtered = csv2023.filter('','','',date_start_adjusted,date_end_str)

# dates = filtered.pivot_table(index = ['DATE'], columns = ['BRANCH'], values = ['OR'], aggfunc = lambda x: len(x.unique()),fill_value=0, dropna=False)
dates = filtered.pivot_table(index = ['DATE'], columns = ['BRANCH', 'POS'], values = ['QUANTITY'], aggfunc = lambda x:sum(x),fill_value=0, dropna=False)
# dates = filtered.pivot_table(index = ['DATE'], columns = ['BRANCH', 'POS'], values = ['OR'], aggfunc = lambda x: len(x.unique()),fill_value=0, dropna=False)
csvDates = dates.reset_index()
csvDates.to_csv('Missing_dates.csv')
branches = []
parentDir = os.getcwd()


with open(parentDir + "/settings/branches.txt","r") as f:
    for row in f.read().splitlines():
        branches.append(row.strip())
expected = set()
current_date = date_start
while current_date <= date_end:
    for branch in branches:
        for pos in ["1", "2"]:
            expected.add((branch, pos, current_date.strftime("%Y-%m-%d")))
    current_date += datetime.timedelta(days=1)

# Build existing set of (branch,pos,date)
existing = set()
for d in dates.index:
    date_str = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d).split()[0]
    for (_, branch, pos) in dates.columns:
        if dates.loc[d, ('QUANTITY', branch, pos)] > 0:  # means data exists
            existing.add((branch, str(pos), date_str))

# Missing = Expected - Existing
missing = expected - existing

# Organize missing into dict by branch -> pos -> [dates]
branches_missing = {}
for branch, pos, mdate in missing:
    pos = int(pos)
    if branch not in branches_missing:
        branches_missing[branch] = {}
    if pos not in branches_missing[branch]:
        branches_missing[branch][pos] = []
    branches_missing[branch][pos].append(mdate)

print("Missing structure:")
# pprint.pprint(expected)
# pprint.pprint(existing)
# pprint.pprint(missing)
pprint.pprint(branches_missing)
# pprint.pprint(dates)
# pprint.pprint(dates)

# oa = input("What are the dates?")
rep = Receive(date_start,date_end,dates['QUANTITY'])

rep.missing_fetch(branches_missing)

print("✅ Missing data fetch complete.")
csv2023 = CSVProcessor("record2025.csv")

value = 'Amount'
date_start = datetime.datetime.strptime("2025-07-01", "%Y-%m-%d")
# date_start = datetime.datetime.now()
date_start = (date_start - datetime.timedelta(days=7)).strftime('%Y-%m-%d')
date_end = datetime.datetime.now().strftime("%Y-%m-%d")

filtered = csv2023.filter('','','',date_start_adjusted,date_end_str)

# dates = filtered.pivot_table(index = ['DATE'], columns = ['BRANCH'], values = ['OR'], aggfunc = lambda x: len(x.unique()),fill_value=0, dropna=False)
dates = filtered.pivot_table(index = ['DATE'], columns = ['BRANCH', 'POS'], values = ['QUANTITY'], aggfunc = lambda x:sum(x), fill_value=0, dropna=False)
csvDates = dates.reset_index()
csvDates.to_csv('Missing_dates_new.csv')