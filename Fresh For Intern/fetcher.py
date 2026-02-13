import random
import os
import time
import requests
import datetime
import os
import pandas
import datetime
import unicodedata
import shutil
from combiner import Combiner

class Receive():

	def __init__(self, start_time,end_time,datearr=pandas.DataFrame()):		
		self.exitFlag = 0

		self.parentDir = os.getcwd()
		#parentDir = "/storage/emulated/0"

		if datearr.empty:
			self.sfull = start_time.split("-")
			self.efull = end_time.split("-")
			print(self.sfull)
			print(self.efull)
	
			self.start = datetime.date(int(self.sfull[0]),int(self.sfull[1]),int(self.sfull[2]))
			self.end = datetime.date(int(self.efull[0]),int(self.efull[1]),int(self.efull[2]))

			self.dlist = pandas.date_range(self.start,self.end,freq='d')
		else:
			self.dlist = datearr
		self.branches = []
		self.f1=open( self.parentDir + "/settings/branches.txt","r")
		self.file=self.f1.read()
		for row in self.file.splitlines():
			self.branches.append(row)
		self.empty = []

	def send(self, branch, pos, date):
		filt_date = str(date)[:10]
		print("Arguments")
		print(branch)
		print(pos)
		print(date)
		print("Fetching: " + branch +" POS #" + str(pos) + " for date " + str(filt_date))
		for i in range(3):
			try:
				self.headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.12; rv:55.0) Gecko/20100101 Firefox/55.0',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    			'Accept-Language': 'en-US,en;q=0.5',
    			'Content-Type': 'application/x-www-form-urlencoded',
    			'Referer': 'https://biggsph.com/',
    			'Origin': 'https://biggsph.com'}
				self.url = 'https://biggsph.com/biggsinc_loyalty/controller/fetch_list2.php'
				self.s = requests.Session()
				self.data = {'branch' : branch, 'pos': pos, 'date': filt_date}
				self.r = requests.Request('POST',self.url, data = self.data, headers = self.headers).prepare()
				self.resp = self.s.send(self.r)
				# print("Report List:")
				# print(self.resp.text)
				if "<!doctype html>" in self.resp.text:
					return [""]
				else:
					return self.resp.text.split(",")
				break
			except Exception as e:
				print(e)

	def download_file(self, url, destination):
		for i in range(3):
			try:
				if(not url == ""):
					self.headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.12; rv:55.0) Gecko/20100101 Firefox/55.0',}
					self.local_filename = self.parentDir + "/" + destination + "/" + url.split('/')[-1]
					# NOTE the stream=True parameter below
					with requests.get("https://biggsph.com/biggsinc_loyalty/controller/" + url, stream=True, headers = self.headers) as r:
						r.raise_for_status()
						with open(self.local_filename, 'wb') as f:
							for chunk in r.iter_content(chunk_size=8192): 
								# If you have chunk encoded response uncomment if
								# and set chunk_size parameter to None.
								#if chunk: 
								f.write(chunk)
					return self.local_filename
				else:
					return ""
				break
			except Exception as e:
				print(e)
				return ""

	def process(self,filearray,pos):
		try:
			filetypes = ["rd1800", "blpr", "discount", "rd5000", "rd5500", "rd5800", "rd5900"]
			self.maxfile = {ftype: {"file": "", "count": 0} for ftype in filetypes}
			self.tempfile = ""
			self.maxcount = 0
			self.tempcount = 0
			self.local = ""
			for file in filearray:
				if file != "":
					# ? Download the file to temp folder
					print("Downloading file: " + file)
					self.tempfile = self.download_file(file,"latest")
					
			# 		# f1 = open(self.tempfile,"r")
			# 		with open(self.tempfile, "r") as f1:
			# 			self.tempcount = len(f1.readlines())
			# 		# Check which type this file belongs to
			# 		for ftype in filetypes:
			# 			if ftype in file.lower():  # match by keyword in filename
			# 				if self.tempcount >= self.maxfile[ftype]["count"]:
			# 					self.maxfile[ftype]["count"] = self.tempcount
			# 					self.maxfile[ftype]["file"] = file
			# for ftype, info in self.maxfile.items():
			# 	print(f"Type: {ftype}, Max Count: {info['count']}, Max File: {info['file']}")
			# huh = input("huh")

			# Save all latest files
			# for ftype, info in self.maxfile.items():
			# 	if info["file"] != "" and info["count"] > 0:
			# 		print("Saving latest for " + ftype + ": " + info["file"])
			# 		local = self.download_file(info["file"], "latest")

			# 		if local != "":
			# 			with open(local, "r") as f2:
			# 				content = f2.read()
			# 				newcontent = unicodedata.normalize('NFKD', content).encode('ascii', 'ignore').decode('ascii')

			# 			with open(local, "w") as f3:
			# 				f3.write(newcontent.replace('="', '').replace('"', ''))

			# 			# Load, adjust, and save back without headers
			# 			posalign = pandas.read_csv(local, dtype=str, index_col=False, header=0)
			# 			print("posalign for " + ftype)
			# 			# print(posalign)
			# 			posalign.to_csv(local, index=False, header=False)
			# 		else:
			# 			print("Process Error: Blank File Name for " + ftype)
			# huh = input("huh")

		except Exception as e:
			print("Process Error")
			print(e)

	def clean(self,directory):
		for filename in os.listdir(directory):
			file_path = os.path.join(directory, filename)
			try:
				if os.path.isfile(file_path) or os.path.islink(file_path):
					os.unlink(file_path)
				elif os.path.isdir(file_path):
					shutil.rmtree(file_path)
			except Exception as e:
				print('Failed to delete %s. Reason: %s' % (file_path, e))

	def fetch(self):
		# print("Fetching from " + str(self.start) + " to " + str(self.end))
		# print(self)
		# exit()
		self.clean(self.parentDir + '/latest')
		self.clean(self.parentDir + '/temp')
		for date in self.dlist:
			# print(date)
			# i = input("hsahdsf")
			print("\nFetching "+ str(date) +" \n")
			for branch in self.branches:
				print("\n\tFetching "+ branch +"\n")
				pos1 = self.send(branch, 1, date)
				pos2 = self.send(branch, 2, date)
				self.process(pos1,1)
				# self.clean(self.parentDir + '/temp')
				self.process(pos2,2)
				# self.clean(self.parentDir + '/temp')
			# input("Generate Combiner")
			compress = Combiner()
			compress.generate()
			self.clean(self.parentDir + '/latest')
			f3 = open(self.parentDir + "/last_record.log","w")
			f3.write((date + datetime.timedelta(days=1)).strftime("%Y-%m-%d"))
			# f3.write(date.strftime("%Y-%m-%d"))
			f3.close()
				# print(pos1)
				# exit()

			# compress.append()
		print ("Maxfiles that have 0 entries:")
		for x in range(len(self.empty)):
			print (self.empty[x])

	# def missing_fetch(self, branches):
	# 	for date in self.dlist.index:
	# 		print("\nFetching "+ str(date) +" \n")
	# 		for branch in self.dlist.columns.values:
	# 			#print(branch)
	# 			if (self.dlist.loc[date,branch] == 0):
	# 				print(branch)
	# 				print("\n\tFetching "+ str(branch) +"\n")
	# 				pos1 = self.send(branch, 1, date)
	# 				pos2 = self.send(branch, 2, date)
	# 				self.process(pos1)
	# 				self.clean(self.parentDir + '/temp')
	# 				self.process(pos2)
	# 				self.clean(self.parentDir + '/temp')
	# 		compress = Combiner()
	# 		compress.generate()
	# 		print("Initiate Append")
	# 		compress.append()
	# 		self.clean(self.parentDir + '/latest')
	# 	print ("Maxfiles that have 0 entries:")
	# 	for x in range(len(self.empty)):
	# 		print (self.empty[x])

	def missing_fetch(self, branches_missing):
		"""
		Fetch only missing records based on branches_missing structure.
		
		branches_missing example:
		{
			'SMNAG': {
				1: ['2025-08-15', '2025-08-16', ...],
				2: ['2025-08-15', '2025-08-16', ...]
			},
			'OTHER_BRANCH': {
				1: ['2025-08-20'],
				2: ['2025-08-20']
			}
		}
		"""
		# Clean up directories first
		self.clean(self.parentDir + '/latest')
		self.clean(self.parentDir + '/temp')

		for branch, pos_dict in branches_missing.items():
			print(f"\nFetching missing data for branch: {branch}\n")

			for pos, dates in pos_dict.items():
				for date in dates:
					print(f"\tFetching branch {branch}, pos {pos}, date {date}")

					# Call send to get the data
					result = self.send(branch, pos, date)

					# Process it
					self.process(result, pos)

					# Clean temp after each pos fetch
					# self.clean(self.parentDir + '/temp')

			# After processing a branch, you may want to combine/compress
			compress = Combiner()
			compress.generate()
			self.clean(self.parentDir + '/latest')

			# Update log with the last processed date
			if dates:  # only if there are dates
				last_date = max(dates)
				# with open(self.parentDir + "/last_record.log", "w") as f3:
				# 	f3.write((datetime.datetime.strptime(last_date, "%Y-%m-%d") + datetime.timedelta(days=1)).strftime("%Y-%m-%d"))

		print("Maxfiles that have 0 entries:")
		for x in range(len(self.empty)):
			print(self.empty[x])
	def missing_pos_fetch(self):
		for date in self.dlist.index:
			print("\nFetching "+ str(date) +" \n")
			for branch in self.dlist.columns.values:
				#print(branch)
				if (self.dlist.loc[date,branch] == 0):
					print(branch)
					print("\n\tFetching "+ str(branch) +"\n")
					pos = self.send(branch[:-1], int(branch[-1:]), date)
					print("POS: ")
					print(pos)
					self.process(pos, int(branch[-1:]))
					self.clean(self.parentDir + '/temp')
			compress = Combiner()
			compress.generate()
			print("Initiate Append")
			compress.append()
			self.clean(self.parentDir + '/latest')
		print ("Maxfiles that have 0 entries:")
		for x in range(len(self.empty)):
			print (self.empty[x])