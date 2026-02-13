import random
import os
import time
import requests
import datetime
import os
import pandas
from fetcher import Receive
from combiner import Combiner

parentDir = os.getcwd()
# combiner = Combiner()
# combiner.generate()
# # f3 = open(parentDir + "/last_record.log","w")
# # # 2025-08-20
# # # f3.write(datetime.datetime.now().strftime('%Y-%m-%d'))
# # f3.write(str(datetime.datetime.strptime("2025-08-21", "%Y-%m-%d").date()))
# # f3.close()
# exit()
f1 = open(parentDir + "/last_record.log","r")
file = f1.read()
f1.close()
last = datetime.datetime.strptime(file, '%Y-%m-%d').date().strftime('%Y-%m-%d')
# last = '2025-12-1'

print(last)
prev = (datetime.datetime.now() - datetime.timedelta(days=1)).strftime('%Y-%m-%d')
prev = '2025-12-31'
# prev = '2026-2-1'
print(prev)

rep = Receive(last,prev)
rep.fetch()
# exit()
f3 = open(parentDir + "/last_record.log","w")
f3.write(datetime.datetime.now().strftime('%Y-%m-%d'))
f3.close()
 