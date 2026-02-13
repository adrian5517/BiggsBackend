import pandas as pd
import numpy as np
import decimal
from decimal import Decimal
import matplotlib.pyplot as plt
import datetime 
import matplotlib.dates as mdates
from bokeh.plotting import figure, show, output_notebook, output_file, save
from bokeh.layouts import row, column
from bokeh.palettes import Category20_20
from bokeh.models import NumeralTickFormatter
from bokeh.models import HoverTool
from bokeh.models import ColumnDataSource, ranges, LabelSet
import itertools
from bokeh.palettes import inferno
from bokeh.resources import CDN
from bokeh.embed import file_html
import csv
import calendar

class Deredundancer:

	def __init__(self, reference, dept_reference, comb_reference, cate_reference, bran_reference):
		self.reference = reference
		self.dept_reference = dept_reference
		self.comb_reference = comb_reference
		self.cate_reference = cate_reference
		self.bran_reference = bran_reference
		
		with open(self.reference+".csv", mode='r') as infile:
			reader = csv.reader(infile)
			with open(self.reference+'_new.csv', mode='w') as outfile:
				writer = csv.writer(outfile)
				self.conversion = {rows[0]:rows[1] for rows in reader}

		with open(self.dept_reference+".csv", mode='r') as infile:
			reader = csv.reader(infile)
			with open(self.dept_reference+'_new.csv', mode='w') as outfile:
				writer = csv.writer(outfile)
				self.dept_conversion = {rows[0]:rows[1] for rows in reader}

		with open(self.comb_reference+".csv", mode='r') as infile:
			reader = csv.reader(infile)
			with open(self.comb_reference+'_new.csv', mode='w') as outfile:
				writer = csv.writer(outfile)
				self.comb_conversion = {rows[0]:rows[1] for rows in reader}

		with open(self.cate_reference+".csv", mode='r') as infile:
			reader = csv.reader(infile)
			with open(self.cate_reference+'_new.csv', mode='w') as outfile:
				writer = csv.writer(outfile)
				self.cate_conversion = {rows[0]:rows[1] for rows in reader}

		with open(self.bran_reference+".csv", mode='r') as infile:
			reader = csv.reader(infile)
			with open(self.bran_reference+'_new.csv', mode='w') as outfile:
				writer = csv.writer(outfile)
				self.bran_conversion = {rows[0]:rows[1] for rows in reader}

	def convert(self, candidate):
		if candidate in self.conversion.keys():
			return self.conversion[candidate]
		else:
			return str(candidate)

	def convert_dept(self, candidate):
		if candidate in self.dept_conversion.keys():
			return self.dept_conversion[candidate]
		else:
			return str(candidate)

	def convert_comb(self, candidate):
		if candidate in self.comb_conversion.keys():
			return self.comb_conversion[candidate]
		else:
			return str(candidate)

	def convert_cate(self, candidate):
		if candidate in self.cate_conversion.keys():
			return self.cate_conversion[candidate]
		else:
			return str(candidate)

	def convert_bran(self, candidate):
		if candidate in self.bran_conversion.keys():
			return self.bran_conversion[candidate]
		else:
			return str(candidate)

	def convert_pos(self, candidate):
		if candidate == '="0001"':
			print('="0001"')
			return '1'
		elif candidate == '="002"':
			print('="002"')
			return '2'
		elif candidate == '="025"':
			print('="025"')
			return '1'
		else:
			return str(candidate)

	def typecast(self, candidate):
		switcher = {
			"D" : "DINE-IN",
			"T" : "TAKEOUT",
			"C" : "DELIVERY"
		}
		switcher.get(candidate,"NONE")

	def typeconvert(self,candidate):
		print(candidate)
		if (candidate['DEPARTMENT NAME CLEAN'] == "FOOD PANDA"):
			return "DELIVERY"
		else:
			return candidate['TRANSACTION TYPE']



class CSVProcessor:

	def convert_dtype(self, x):
		try:
			while (float(x) < 1.00) and (float(x) > 0.00):
				x = float(x) * 10.0
			return int(float(x))
		except Exception as e:
			print(e)
			return 0

	def turn_decimal(self, x):
		try:
			return Decimal(x)
		except:
			return Decimal(0.0)

	def time_set(self,value):
		if ":" in str(value)[:2]:
			return "0" + str(value)
		return str(value)

	def pandafy(self, row):
		if row['DEPARTMENT NAME CLEAN'] == "FOOD PANDA":
			row['PRODUCT NAME CLEAN'] = "FP " + row['PRODUCT NAME CLEAN']
		return row

	def weekpartly(self,weekday):
		if weekday in ['Monday','Tuesday','Wednesday','Thursday']:
			return 'Weekday'
		elif weekday in ['Friday','Saturday','Sunday']:
			return 'Weekend'
		else:
			return ''

	def quarterly(self,quarter):
		return (((int(quarter))-1)/3)+1

	def semiannually(self,semi):
		return (((int(semi))-1)/6)+1

	def week_of_month(self,tgtdate):
		days_this_month = calendar.mdays[tgtdate.month]
		for i in range(1, days_this_month):
			d = datetime.datetime(tgtdate.year, tgtdate.month, i)
			if d.day - d.weekday() > 0:
				startdate = d
				break
		# now we canuse the modulo 7 appraoch
		return (tgtdate - startdate).days //7 + 1

	def troubleshoot(self, x):
		try:
			return str(int(str(x)[:2]))
		except Exception as error:
			print ("Error with x " + str(x) + " with error type " + str(error))
			return '25'


	def __init__(self, file):

		self.converter = Deredundancer("conversion","conversion_dept","conversion_combined","conversion_category","conversion_branch")

		self.dayarr = ['Breakfast','Lunch','PM Snack','Dinner','GY']

		self.columns = {
			'POS':'str',
			'OR':'str',
			'ITEM CODE':'str',
			'DEPARTMENT CODE':'str',
			'DISCOUNT CODE':'str',
			'TYPE CODE':'str',
			'VAT FLAG':'str',
			'TRANSACTION NUMBER':'str',
			'PRODUCT NAME':'str',
			'DEPARTMENT NAME':'str',
			'DISCOUNT NAME':'str',
			'TRANSACTION TYPE':'str',
			'DAYPART':'str',
			'PAYMENT CODE':'str',
			'PAYMENT NAME':'str',
			'PHONE NUMBER':'str',
			'BRANCH':'str'
		}

		self.df = pd.read_csv(file,sep=",",header=0,dtype=self.columns,converters={'QUANTITY':self.convert_dtype,'UNIT PRICE': self.turn_decimal,'AMOUNT': self.turn_decimal,'DISCOUNT': self.turn_decimal,'VAT DIV': self.turn_decimal,'VAT AMOUNT': self.turn_decimal,'VAT_DISCOUNT': self.turn_decimal,'VAT PRICE': self.turn_decimal,'TIME': self.time_set},parse_dates=['DATE'], index_col=False)

		self.df['PRODUCT NAME CLEAN'] = self.df['PRODUCT NAME'].apply(lambda x: self.converter.convert(str(x).upper()))

		self.df['DEPARTMENT NAME CLEAN'] = self.df['DEPARTMENT NAME'].apply(lambda x: self.converter.convert_dept(str(x).upper()))

		self.df['PRODUCT NAME COMBINED'] = self.df['PRODUCT NAME CLEAN'].apply(lambda x: self.converter.convert_comb(str(x).upper()))

		self.df['CATEGORY'] = self.df['PRODUCT NAME CLEAN'].apply(lambda x: self.converter.convert_cate(str(x).upper()))

		self.df['BRANCH CLEAN'] = self.df['BRANCH'].apply(lambda x: self.converter.convert_bran(str(x).upper()))

		self.df['POS'] = self.df['POS'].apply(lambda x: self.converter.convert_pos(str(x)))

		#self.df = self.df.apply(lambda row : self.pandafy(row), axis = 1)

		self.df['DAYPART'] = pd.Categorical(self.df['DAYPART'], categories=self.dayarr)
		# print("Raw DATE column values:")
		# print(self.df['DATE'].head(10))   # show first 10 rows

		print("DAY!")
		self.df['DATE'] = pd.to_datetime(self.df['DATE'],errors='coerce')
		# print("Parsed DATE column values:")
		# print(self.df['DATE'].head(10))
		self.df['DATE_STR'] = self.df['DATE'].dt.strftime('%Y-%m-%d')
		self.df['WEEK'] = self.df['DATE'].dt.strftime('%U')
		self.df['WEEKDAY'] = self.df['DATE'].dt.day_name()
		self.df['TIME'].apply(lambda x: '00:00' if x == '' else x)
		self.df['HOUR'] = self.df['TIME']
		self.df['HOUR']= self.df['HOUR'].apply(lambda x: self.troubleshoot(x))
		self.df['MONTH'] = pd.DatetimeIndex(self.df['DATE']).month
		self.df['YEAR'] = pd.DatetimeIndex(self.df['DATE']).year
		self.df['DAY'] = pd.DatetimeIndex(self.df['DATE']).day
		self.df['GID'] = self.df['OR']+self.df['BRANCH']+self.df['TIME'] #ID for the Unique Transaction
		self.df['GUID'] = self.df['OR']+self.df['BRANCH']+self.df['POS']
		self.df['RGID'] = self.df['GID'] + self.df['ITEM CODE'] + self.df['DISCOUNT CODE']
		self.df['DATE STRING'] = self.df['DATE'].astype(str)
		print(self.df['TRANSACTION TYPE'])
		#self.df['TYPE CLEAN'] = self.df['TRANSACTION TYPE'].apply(lambda x: self.converter.typecast(str(x).upper()))
		#self.df['TYPE CLEAN'] = self.df.apply(lambda x: self.converter.typeconvert(x))
		#self.df['TYPE CLEAN'].mask(self.df['DEPARTMENT NAME CLEAN'] == 'FOOD PANDA', "DELIVERY", inplace=True)
		self.df.loc[self.df['DEPARTMENT NAME CLEAN'] == "FOOD PANDA", 'TRANSACTION TYPE'] = "Food Panda"
		self.df['WEEK OF MONTH'] = self.df['DATE'].apply(lambda x: (x.day-1) // 7 + 1)
		self.df['WEEK OF MONTH'] = self.df['WEEK OF MONTH'].apply(lambda x: x if x < 5 else 4)
		#self.df['WEEKPART'] = self.df['WEEKDAY'].apply(lambda x: self.weekpartly(x), axis=1)
		#self.df['QUARTER'] = self.df['QUARTER'].apply(lambda x: self.quarterly(x), axis=1)
		#self.df['SEMI'] = self.df['SEMI'].apply(lambda x: self.semiannually(x), axis=1)


	def getdata(self):
		return self.df

	def np_date(self, date):
		return np.datetime64(datetime.date(int(date[:4]),int(date[5:7]),int(date[8:])))

	def filter(self, branch_filter, department_filter, product_filter, date_start, date_end):
		product_filter_out = ['DELIVERY CHARGE','DOUBLE TREAT','2 MEAL P400','NO SALT','WING AND THIGH','LESS CREAM','CHARGE TAKEOUT BOX','NOT BREAST','SNACK 3','NOT WING','PACKAGING','CHX SPG FRIES IT','PC TOCINO','CHARGE TAKEOUT BEV','THIGH','CUP TAKE OUT','DOG FOOD','WITH CUTLERY','DOUBLE DATE TREAT','WING','HALO SUP``E','WELLDONE','NO CHARON','NO ICE','NOT SPICY','NOT COLD','ADVANCE CALL','OUT NA','FOR PICKUP','BREAST','LESS ICE','BREAST AND WING','LESS SPICY','SEPARATE ICE','BACON','SERVE LATER','BREAST AND THIGH','VEGGIES ONLY','SUPER HOT','IN PLATE','SEPARATE CHARON','SALAD DRESSING','HOT TEA','CASH TAKEOUT BEV','STYRO','MEDLEY COLESLAW','MEDLEY ORIENTAL SALAD','PAUNA','MORE SPICY','SEPARATE RICE','WING AND BREAST','PORK BBQ-4PCS 275G','CHUNKY CHICKEN','NO DRESSING','NO SUGAR','Italian Puttanesca','NO CREAM','NO SCALLION','VEGGIES-REGULAR','NAN','NA']
		dept_filter_in = department_filter
		product_filter_in = product_filter
		branch_filter_in = branch_filter

		source = self.df[(self.df['DATE']>=self.np_date(date_start)) & (self.df['DATE']<=self.np_date(date_end))].query("`PRODUCT NAME CLEAN` not in @product_filter_out").query("`DEPARTMENT NAME` != ''").query("`PRODUCT NAME`!=''").query("`PRODUCT NAME CLEAN`!= 'NAN'")

		if (branch_filter != ''):
			source = source.query("`BRANCH` in @branch_filter_in")

		if (department_filter != ''):
			source = source.query("`DEPARTMENT NAME CLEAN` in @dept_filter_in")

		if (product_filter != ''):
			source = source.query("`PRODUCT NAME CLEAN` in @product_filter_in")

		return source

	def filterfull(self, branch_filter, department_filter, product_filter, date_start, date_end, day_filter, daypart_filter, hour_filter, discount_filter):
		product_filter_out = ['DELIVERY CHARGE','DOUBLE TREAT','2 MEAL P400','NO SALT','WING AND THIGH','LESS CREAM','CHARGE TAKEOUT BOX','NOT BREAST','SNACK 3','NOT WING','PACKAGING','CHX SPG FRIES IT','PC TOCINO','CHARGE TAKEOUT BEV','THIGH','CUP TAKE OUT','DOG FOOD','WITH CUTLERY','DOUBLE DATE TREAT','WING','HALO SUP``E','WELLDONE','NO CHARON','NO ICE','NOT SPICY','NOT COLD','ADVANCE CALL','OUT NA','FOR PICKUP','BREAST','LESS ICE','BREAST AND WING','LESS SPICY','SEPARATE ICE','BACON','SERVE LATER','BREAST AND THIGH','VEGGIES ONLY','SUPER HOT','IN PLATE','SEPARATE CHARON','SALAD DRESSING','HOT TEA','CASH TAKEOUT BEV','STYRO','MEDLEY COLESLAW','MEDLEY ORIENTAL SALAD','PAUNA','MORE SPICY','SEPARATE RICE','WING AND BREAST','PORK BBQ-4PCS 275G','CHUNKY CHICKEN','NO DRESSING','NO SUGAR','Italian Puttanesca','NO CREAM','NO SCALLION','VEGGIES-REGULAR','NAN','NA']
		dept_filter_in = department_filter
		product_filter_in = product_filter
		branch_filter_in = branch_filter
		day_filter_in = day_filter
		daypart_filter_in = daypart_filter
		hour_filter_in = hour_filter
		discount_filter_in = discount_filter

		print(self.df)

		source = self.df[(self.df['DATE']>=self.np_date(date_start)) & (self.df['DATE']<=self.np_date(date_end))].query("`PRODUCT NAME CLEAN` not in @product_filter_out").query("`DEPARTMENT NAME` != ''").query("`PRODUCT NAME`!=''").query("`PRODUCT NAME CLEAN`!= 'NAN'")

		if (branch_filter != []):
			print("Branch Filter Reach")
			print(branch_filter)
			print(source)
			source = source.query("`BRANCH` in @branch_filter_in")
			print("after branch filter")
			print(source)

		if (department_filter != []):
			print("department Filter Reach")
			print(department_filter)
			print(source)
			source.to_csv(".\\troubleshoot1.csv")
			source = source.query("`DEPARTMENT NAME CLEAN` in @dept_filter_in")
			print("after department filter")
			print(source)

		if (product_filter != []):
			print("product Filter Reach")
			print(product_filter)
			print(source)
			source.to_csv(".\\troubleshoot2.csv")
			source = source.query("`PRODUCT NAME CLEAN` in @product_filter_in")
			print("after product filter")
			print(source)

		if (day_filter != []):
			print("day Filter Reach")
			print(day_filter)
			print(source)
			source = source.query("`WEEKDAY` in @day_filter_in")
			print("after day filter")
			print(source)

		if (daypart_filter != []):
			print("daypart Filter Reach")
			print(daypart_filter)
			print(source)
			source = source.query("`DAYPART` in @daypart_filter_in")
			print("after daypart filter")
			print(source)

		if (hour_filter != []):
			print("hour Filter Reach")
			print(hour_filter)
			print(source)
			source = source.query("`HOUR` in @hour_filter_in")
			print("after hour filter")
			print(source)

		if (discount_filter != []):
			print("discount Filter Reach")
			print(discount_filter)
			print(source)
			source = source.query("`DISCOUNT NAME` in @discount_filter_in")
			print("after discount filter")
			print(source)

		return source

	def pivot_bar(self, source, index, value, height, width, title):
		if(value == 'Quantity'):
			value_unit = "QUANTITY"
		else:
			value_unit = "AMOUNT"

		print("Source:")
		print(source)
		colors ={0:	[6, 7, 8, 9, 10],1:[11, 12, 13, 14],2:[15, 16, 17, 18],3:[19, 20, 21, 22],4:[0, 1, 2, 3, 4, 5, 23]}
		dpref = ['Breakfast', 'Lunch', 'PM Snack', 'Dinner', 'GY']

		palette_colors = inferno(5)

		if (index == 'Department'):
			index_unit = 'DEPARTMENT NAME CLEAN'
		elif (index == 'Product'):
			index_unit = 'PRODUCT NAME CLEAN'
		elif (index == 'Hour'):
			index_unit = 'HOUR'
		result = source.pivot_table(index = [index_unit],values = [value_unit],aggfunc=lambda x: sum(x),fill_value=0, dropna=False)


		if (value_unit == 'AMOUNT'):
			result['AMOUNT'] = result['AMOUNT'].apply(lambda x: int(int(x* 100)/100))
		result = result.reset_index()
		result['HOUR'] = result['HOUR'].astype(int)

		print("Hour Bar")
		print(result)

		buffer = pd.DataFrame(
				{
					"HOUR": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],
					"AMOUNT": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
				},
				index=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],
			)
		result = pd.concat([result,buffer])

		print("Hour Bar Post")
		print(result)

		result = result.pivot_table(index = [index_unit],values = [value_unit],aggfunc=lambda x: sum(x),fill_value=0, dropna=False)
		result = result.reset_index()

		total = sum(result[value_unit])
		if(total == 0):
			total = 1

		percent = ["{:10.0f}".format(float((p/total)*100)) + "%" for p in result[value_unit]]

		

		hour_colors = []
		r_daypart = []
		for i in range(24):
			key = [key for key, value in colors.items() if i in value]
			print("index: " + str(i) + "\nkey: "+ str(key))
			hour_colors.append(palette_colors[4-key[0]])
			r_daypart.append(dpref[key[0]])

		data = {'index':result[index_unit],'value':result[value_unit],'color':hour_colors,'percentage':percent}
		cds = ColumnDataSource(data=data)

		print(r_daypart)

		result['DAYPART'] = r_daypart

		daypart = {'Daypart': ['GY', 'Breakfast', 'Lunch', 'PM Snack', 'Dinner'],'hour': [2,8,12,16,20],'y_set':[0,0,0,0,0],}

		daypart_source = ColumnDataSource(data=daypart)

		labels = LabelSet(x='index', y='value', text='percentage', level='glyph',x_offset=-40, y_offset=3, text_font_size="10pt", source=cds, text_color = 'black', text_alpha=0.75)

		label2 = LabelSet(x='hour', y='y_set', text='Daypart', level='glyph',x_offset=0, y_offset=-20, text_font_size="10pt", source=daypart_source, text_color = 'black', text_alpha=0.75)

		if (index_unit == 'HOUR'):
			fig = figure(height = height, width = width,title=title,tools="pan,wheel_zoom,box_zoom,reset,hover",tooltips="@{index}: @value{0,0 a}",y_axis_label=value,x_axis_label=index)
		else:
			fig = figure(x_range=result[index_unit],height = height, width = width,title=title,tools="pan,wheel_zoom,box_zoom,reset,hover",tooltips="@x: @top{0,0 a}",y_axis_label=value,x_axis_label=index)

		vbarray = []

		for idx, x in enumerate(daypart['Daypart']):
			temp = []
			temp = result[(result['DAYPART']==x)]
			tempsource = {'index':temp[index_unit],'value':temp[value_unit]}
			fig.vbar(x = 'index', top='value', width=0.9, source=ColumnDataSource(data=tempsource), color=palette_colors[idx], legend_label=x)
		
		fig.add_layout(labels)
		#fig.add_layout(label2)
		fig.yaxis.major_tick_line_color = None
		fig.yaxis.minor_tick_line_color = None
		fig.yaxis.major_label_text_color = None
		fig.xaxis.major_label_text_color = None
		fig.xgrid.grid_line_color = None	
		fig.ygrid.grid_line_color = None
		fig.y_range.range_padding = 0.3
		fig.x_range.range_padding = 0.10
		fig.add_layout(fig.legend[0], 'right')
		

		return {'figure':fig, 'dataframe':result}

	def pivot_line(self, source, value, height, width, title):
		if(value == 'Quantity'):
			value_unit = "QUANTITY"		
		else:
			value_unit = "AMOUNT"

		index_unit = 'DATE'

		result = source.pivot_table(index = [index_unit],values = [value_unit],aggfunc=lambda x: sum(x),fill_value=0, dropna=False)

		hovertool_line = HoverTool(tooltips=[("Date","@DATE{%F}"),("Value"," @"+value_unit+"{0,0 a}")],formatters={'@DATE': 'datetime'})

		if (value_unit == 'AMOUNT'):
			result['AMOUNT'] = result['AMOUNT'].apply(lambda x: (int(x* 10))/10)
		result = result.reset_index()
		if (index_unit == 'HOUR'):
			fig = figure(height = height, width = width,title=title,tools="pan,wheel_zoom,box_zoom,reset",y_axis_label=value,x_axis_label=index_unit)
		else:
			fig = figure(height = height, width = width,title=title,tools="pan,wheel_zoom,box_zoom,reset",y_axis_label=value,x_axis_label=index_unit)
		fig.line(index_unit, value_unit, width=0.9, source=result)
		fig.yaxis.major_tick_line_color = None
		fig.yaxis.minor_tick_line_color = None
		fig.yaxis.major_label_text_color = None
		fig.xaxis.major_label_text_color = None
		fig.xgrid.grid_line_color = None
		fig.ygrid.grid_line_color = None
		fig.y_range.range_padding = 0.3
		fig.x_range.range_padding = 0.10
		fig.add_tools(hovertool_line)
		

		return {'figure':fig, 'dataframe':result}

	def get_tc_ac(self, source):
		result = source.query("`QUANTITY` > 0").query("`AMOUNT` >= 0.00").pivot_table(index = ['GID'], values = ['QUANTITY','AMOUNT'],aggfunc={'QUANTITY':np.sum, 'AMOUNT':lambda x: sum(x)},fill_value=0, dropna=False)
		result['AMOUNT']=(result['AMOUNT']/result['QUANTITY']).apply(lambda x: float(x.quantize(Decimal('1.00'),rounding=decimal.ROUND_CEILING)))
		result = result.rename(columns={'QUANTITY': 'TC', 'AMOUNT': 'AC'})

		arr_hist, edges = np.histogram(result['AC'],bins=[0, 100, 200, 300, 400, np.inf], range = [0, np.inf])
		acgram = pd.DataFrame({'ac_hist': arr_hist,'left': edges[:-1],'right': edges[1:]})
		interval = []
		right_graph = []
		left_old = []
		right_old = []
		left_new = []
		right_new = []

		for left, right in zip(acgram['left'], acgram['right']):
			left_old.append(left + 10)
			left_new.append(left + 40)
			if right == np.inf:
				right_old.append(470)
				right_new.append(500)  
				right_graph.append(700)
				interval.append('>=%d' % (left))
			else:
				right_old.append(left + 70)
				right_new.append(left + 100)
				right_graph.append(right)
				interval.append('%d to %d' % (left, right))
		acgram['interval']=interval
		acgram['right_graph'] = right_graph
		acgram['left_old'] = left_old
		acgram['left_new'] = left_new
		acgram['right_old'] = right_old
		acgram['right_new'] = right_new

		total = acgram['ac_hist'].sum()
		if total == 0:
			total = 1
		acgram['percentage'] = [str(int((x/total)*100))+"%" for x in acgram['ac_hist']]

		src = ColumnDataSource(acgram)
		print(acgram)
		src.data['ac_hist'] = [f"{x:n}" % x for x in src.data['ac_hist']]

		return src

	def get_tc(self, source, lastYear):

		hover = HoverTool(tooltips=[("Number of Transactions", "@GID{0,0 a}")])
		hover.point_policy='snap_to_data'

		result = source.pivot_table(index = ['WEEKDAY'], values = ['GID'],aggfunc=lambda x: len(x.unique()),fill_value=0, dropna=False)
		result.reset_index(inplace=True, drop=False)
		total = result['GID'].sum()
		if total == 0:
			total = 1
		result['percentage'] = [str(int((x/total)*100))+"%" for x in result['GID']]

		print("LY:")
		print(lastYear)
		result_ly = lastYear.pivot_table(index = ['WEEKDAY'], values = ['GID'],aggfunc=lambda x: len(x.unique()),fill_value=0, dropna=False)
		result_ly.reset_index(inplace=True,drop=False)
		total_ly = result_ly['GID'].sum()
		if total == 0:
			total = 1
		result_ly['percentage'] = [str(int((x/total_ly)*100))+"%" for x in result_ly['GID']]

		cats = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
		result['WEEKDAY'] = pd.Categorical(result['WEEKDAY'], categories=cats, ordered=True)
		result = result.sort_values('WEEKDAY')
		print('Result:')
		print(result)

		result_ly['WEEKDAY'] = pd.Categorical(result_ly['WEEKDAY'], categories=cats, ordered=True)
		result_ly = result_ly.sort_values('WEEKDAY')
		print("Result_LY")
		print(result_ly)

		fig = figure(height = 400, width = 750,title = "ADTC",x_axis_label = 'Average Daily Transaction Count per Day',y_axis_label = 'Number of Transactions')

		left_old = []
		right_old = []
		left_new = []
		right_new = []

		for left, right in zip([0, 100, 200, 300, 400, 500, 600], [100, 200, 300, 400, 500, 600, 700]):
			left_old.append(left + 10)
			left_new.append(left + 40)
			right_old.append(left + 70)
			right_new.append(left + 100)

		cdsource = ColumnDataSource({'GID':result['GID'], 'GID_ly':result_ly['GID'], 'left_old':left_old, 'right_old': right_old, 'left_new':left_new, 'right_new': right_new, 'percentage': result['percentage']})

		#labels2022 = LabelSet(x='left', y='ac_hist', text='ac_hist', level='glyph',x_offset=2, y_offset=5, text_font_size="10pt", source=lastYear, text_color = 'red', text_alpha=0.75)
		fig.quad(bottom=0, top='GID_ly',left='left_old', right='right_old', source=cdsource,fill_color='gray', legend_label="2022", fill_alpha = 1, line_color='black', width = 0.5)

		labels2023 = LabelSet(x='left_new', y='GID', text='percentage', level='glyph',x_offset=10, y_offset=5, text_font_size="10pt", source=cdsource, text_color = 'black', text_alpha=0.75)
		fig.quad(bottom=0, top='GID',left='left_new', right='right_new', source=cdsource,fill_color='#25AAE1', fill_alpha = 1, legend_label="2023", line_color='black', width = 0.5)

		ticks = [int((left+right)/2) for (left, right) in zip(left_old,right_new)]
		print(ticks)
		label_override = dict.fromkeys(ticks)

		for idx, i in enumerate(ticks):
			label_override[i] = cats[idx]

		fig.add_tools(hover)
		fig.add_layout(labels2023)
		#fig.add_layout(labels2022)
		fig.yaxis.formatter = NumeralTickFormatter(format="0,0")
		fig.yaxis.major_tick_line_color = None
		fig.yaxis.minor_tick_line_color = None
		fig.yaxis.major_label_text_color = None
		fig.xaxis.ticker = ticks
		fig.xaxis.major_label_overrides = label_override
		fig.xgrid.grid_line_color = None
		fig.ygrid.grid_line_color = None
		fig.y_range.range_padding = 0.3
		fig.x_range.range_padding = 0.10
		fig.add_layout(fig.legend[0], 'right')
		

		return {'figure':fig, 'dataframe':result}

	def pivot_histogram(self, source, lastYear, height, width, title):

		hover = HoverTool(tooltips=[("Number of Transactions", "@ac_hist{0,0 a}")])
		hover.point_policy='snap_to_data'

		fig = figure(height = height, width = width,title = title,x_axis_label = 'Average Check Ranges',y_axis_label = 'Number of Transactions')

		#labels2022 = LabelSet(x='left', y='ac_hist', text='ac_hist', level='glyph',x_offset=2, y_offset=5, text_font_size="10pt", source=lastYear, text_color = 'red', text_alpha=0.75)
		fig.quad(bottom=0, top='ac_hist',left='left_old', right='right_old',source=lastYear,fill_color='gray', legend_label="2022", fill_alpha = 1, line_color='black', width = 0.5)

		labels2023 = LabelSet(x='left_new', y='ac_hist', text='percentage', level='glyph',x_offset=10, y_offset=5, text_font_size="10pt", source=source, text_color = 'black', text_alpha=0.75)
		fig.quad(bottom=0, top='ac_hist',left='left_new', right='right_new',source=source,fill_color='#25AAE1', fill_alpha = 1, legend_label="2023", line_color='black', width = 0.5)
		
		ticks = [int((left+right)/2) for (left, right) in zip(lastYear.data['left_old'],source.data['right_new'])]
		print(ticks)
		print(source.data['interval'])
		label_override = dict.fromkeys(ticks)

		for idx, i in enumerate(ticks):
			label_override[i] = source.data['interval'][idx]


		fig.add_tools(hover)
		fig.add_layout(labels2023)
		#fig.add_layout(labels2022)
		fig.yaxis.formatter = NumeralTickFormatter(format="0,0")
		fig.yaxis.major_tick_line_color = None
		fig.yaxis.minor_tick_line_color = None
		fig.yaxis.major_label_text_color = None
		fig.xaxis.ticker = ticks
		fig.xaxis.major_label_overrides = label_override
		fig.xgrid.grid_line_color = None
		fig.ygrid.grid_line_color = None
		fig.y_range.range_padding = 0.3
		fig.x_range.range_padding = 0.10
		fig.add_layout(fig.legend[0], 'right')

		return {'figure':fig, 'dataframe':source.to_df()}

	def top_prod(self, source, value):
		if value == 'Unit Sales':
			value_unit = 'QUANTITY'
		else:
			value_unit = 'AMOUNT'
			source['AMOUNT'] = source['AMOUNT'].apply(lambda x: int((int(x* 10))/int(10)))
			source = source.query('`AMOUNT` > 0.0')
		result = source.query("`PRODUCT NAME CLEAN`!= 'NA'").pivot_table(index = ['PRODUCT NAME CLEAN'], values = [value_unit], aggfunc = lambda x: sum(x), fill_value = 0, dropna = False).sort_values(by = value_unit, ascending=False).head(30)
		result = result.reset_index()
		return result

	def bottom_prod(self, source, value):
		if value == 'Unit Sales':
			value_unit = 'QUANTITY'
		else:
			value_unit = 'AMOUNT'
			source = source.query("`AMOUNT` > 0.00")
			source['AMOUNT'] = source['AMOUNT'].apply(lambda x: int((int(x* 10))/int(10)))
		result = source.query("`PRODUCT NAME CLEAN`!= 'NA'").pivot_table(index = ['PRODUCT NAME CLEAN'], values = [value_unit], aggfunc = lambda x: int(sum(x) * 10)/10 , fill_value = 0, dropna = False).sort_values(by = value_unit, ascending=True).head(30)
		result = result.reset_index()
		return result

	def deptmix_gen(self, source, value):
		if value == 'Unit Sales':
			value_unit = 'QUANTITY'
		else:
			value_unit = 'AMOUNT'
			source = source.query("`AMOUNT` > 0.00")
			source['AMOUNT'] = source['AMOUNT'].apply(lambda x: int((int(x* 10))/int(10)))
		result = source.query("`DEPARTMENT NAME CLEAN`!= 'NA'").pivot_table(index = ['DEPARTMENT NAME CLEAN'], values = [value_unit], aggfunc = lambda x: sum(x) , fill_value = 0, dropna = False).sort_values(by = value_unit, ascending=False)
		result = result.reset_index()
		total = sum(result[value_unit])
		if total == 0:
			total = 1
		print(result)
		result['percentage'] = [float(int((x/total)*10000)/100.0) for x in result[value_unit]]
		print(result[value_unit])
		print(result['percentage'])
		return result

	def branchmix_gen(self, source, value):
		if value == 'Unit Sales':
			value_unit = 'QUANTITY'
		else:
			value_unit = 'AMOUNT'
			source = source.query("`AMOUNT` > 0.00")
			source['AMOUNT'] = source['AMOUNT'].apply(lambda x: int((int(x* 10))/int(10)))
		result = source.query("`BRANCH`!= 'NA'").pivot_table(index = ['BRANCH'], values = [value_unit], aggfunc = lambda x: sum(x) , fill_value = 0, dropna = False).sort_values(by = value_unit, ascending=False)
		result = result.reset_index()
		total = sum(result[value_unit])
		if total == 0:
			total = 1
		print(result)
		result['percentage'] = [float(int((x/total)*10000)/100.0) for x in result[value_unit]]
		print(result[value_unit])
		print(result['percentage'])
		return result

	def prodmix_gen(self, source, value):
		if value == 'Unit Sales':
			value_unit = 'QUANTITY'
		else:
			value_unit = 'AMOUNT'
			source = source.query("`AMOUNT` > 0.00")
			source['AMOUNT'] = source['AMOUNT'].apply(lambda x: int((int(x* 10))/int(10)))
		result = source.query("`PRODUCT NAME CLEAN`!= 'NA'").pivot_table(index = ['PRODUCT NAME CLEAN'], values = [value_unit], aggfunc = lambda x: sum(x) , fill_value = 0, dropna = False).sort_values(by = value_unit, ascending=False)
		result = result.reset_index()
		total = sum(result[value_unit])
		if total == 0:
			total = 1
		print(result)
		result['percentage'] = [float(int((x/total)*10000)/100.0) for x in result[value_unit]]
		print(result[value_unit])
		print(result['percentage'])
		return result

	def data_gen(self, source):
		keep = ['OR','ITEM CODE','QUANTITY','UNIT PRICE','AMOUNT','DATE','TIME','PRODUCT NAME CLEAN','DEPARTMENT NAME CLEAN','DISCOUNT NAME','TRANSACTION TYPE','DAYPART','PAYMENT NAME','BRANCH']
		result = source[keep]
		return result

	def getBranch(self):
		return self.df['BRANCH'].dropna().unique().tolist()

	def getDepartment(self):
		return self.df['DEPARTMENT NAME CLEAN'].dropna().unique().tolist()

	def getProduct(self):
		return self.df['PRODUCT NAME CLEAN'].dropna().unique().tolist()

	def getDiscount(self):
		return self.df['DISCOUNT NAME'].dropna().unique().tolist()

	def getDay(self):
		return self.df['WEEKDAY'].dropna().unique().tolist()

	def getDaypart(self):
		return self.df['DAYPART'].dropna().unique().tolist()
	
	def getPayment(self):
		return self.df['PAYMENT NAME'].dropna().unique().tolist()

	def getTransactionType(self):
		return self.df['TRANSACTION TYPE'].dropna().unique().tolist()

	def getProductNameCombined(self):
		return self.df['PRODUCT NAME COMBINED'].dropna().unique().tolist()

	


