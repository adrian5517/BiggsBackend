

# Business Intelligence
The purpose of Business Intelligence in Biggs is to collate Product Performance and Materials Demand (via the Bill Of Materials) to generate reports, provide reference databases for BI Systems, and automate key company processes. This allows for key personnel to make informed, efficient decisions for BIGGS business strategies. 

## Tools and Concept
We mostly utilize python 3.8.10 to make scripts for Data Processing and for software. Should you need to connect to the MK Local Data Server, inform me and remotely do so through AnyDesk code `1 666 334 115` with the password `master2008`. Should you need access to files or sample from the Cloud Server, inform me and they shall be provided. If Cloud Server systems such as API must be modified, consult me first.

## Data Processing Tools
For the Data Processing aspect of the Project you will need to be acquainted with the following tools and concepts:
- Python
	- Decimal Datatype
	- Pandas Data Library
		- Dataframe and Series Manipulation
			- transpose
			- join
			- loc
		- Common Functions
			- read_csv
			- query
			- pivot_table
				- aggregator functions	
					- sum(x)
					- len(x.unique())
					- mean(x)
			- to_csv
## Masterfile Manipulation Basics
- Pandasbiggs Data Library
		- CSVProcessor
		- filter
- CSV table format
	- Plaintext CSV Data Manipulation

## Cloud Server Data Collation
As part of a Store's End of Day process, the managers run the POS Report Sending application to send their daily report to our Cloud Server. The report is in the form of 6 CSV files sent to our API, which are then stored in the `data_archive` folder on the Cloud server and logged in the associated `pos_extract` MySQL table.

### POS Reports
Each POS machine sends a batch of 7 csv reports:
 - **blpr.csv** is a table containing the Biggs Loyalty Program visit registration information
 - **discount** is a table containing the details of valid discounts in the POS system during the time of the extraction
 - **rd1800** is a table containing the details of valid departments (that is, product categories) in the POS system during the time of the extraction
  - **rd5500** is a table containing the details of valid products in the POS system during the time of the extraction
  - **rd5900** is a table containing the details of valid payment methods in the POS system during the time of the extraction
   - **rd5000** is a table containing the details of all product-based transactions (orders) during the day
   - **rd5800** is a table containing the details of all monetary transactions during the day

Details regarding the columns and information within the reports can be found in the `Header_Overview.md` file provided in the packet.

### MySQL Report Tracker
When a sent file is logged in `pos_extract`, the system records the path to the file within the Cloud Server, the day that the data within the file corresponds to, its branch of origin, and the pos number of the POS machine the data is from.

These logs are used to monitor the report compliance of stores, and whether a report is corrupted or fulfilled. To access the monitoring portal, request permission from Sir Don Curativo.

## Local and System Data
From this provided data, we compile the store data into various bins. The primary bin that this data is collated into is the **Local Masterfile** that is handled by Sir Don Curativo. This is where data requests are generated from.

Aside from the Local Masterfile, there are two Cloud Databases that BI Systems are dependent on:

-  **AIM AI Database.** This cloud database contains data compiled for the AIM AI Forecasting System to retrieve from to populate its local training data.
- **Data Reporting.** This cloud database contains data compiled for the Data Reporting tool to query data from.

Each of these Databases have specific formats that they require data from the reports to conform to.

## AIM-Specific Data Format
The AIM System only requires the Product, Department, and Order information because it only tracks Product Performance from the Historic Data.

### rd1800 Format
| Column | Use/Contents | Data Type |
| ----- | ----- | ----- |
|DEP_CODE| Department Code in OS | String
|DEPDESC| Deatment Name | String
|POS| Pos Machine | String
| BRANCH | Branch Code | String

### rd5000 Format
| Column | Use/Contents | Data Type
| ----- | ----- | ----- |
|TRANSDATE| Transaction Date. Formatted in DATETIME but only the DATE portion is used. | DATETIME
|ITE_CODE| Item code of the item in the transaction. Discounts are counted as items with negative Amount and 0 Discount. | String
|QUANTITY| Quantity of an item in an order. | Integer
| DEP_CODE | Code of the Department the Item belongs to. | String
| DATE | Date the item transaction was made. | String (YYY-mm-dd)
| TIME | Time transaction was made. | (HH:mm)
| TYPE | Dine-In, Takeout, Delivery. D for Dine-In, T for Takeout, C for Delivery. | String
| DELIVERY | 1 when the transaction is a delivery, 0 if it is not. | Integer
|POS| Pos Machine | String
| BRANCH | Branch Code | String

### rd5500 Format
| Column | Use/Contents |Data Type
| ----- | ----- | -----|
|INCODE | Product Code | String |
| ITE_DESC| Product Description | String |
| DEP_CODE| Department Code of the Product | String |
| POS | Pos Machine | String
| BRANCH | Branch Code |String

## Data Reporting Tool Format
Name|Use / Content|Data Type
| ----- | ----- | -----|
quantity|number of products|Integer
unit_price|price per unit|Float
amount|total price|Float
date|date of transaction|Date
time|time of transaction|Time
transaction_number|transaction number|String
transaction_type|Dine-In, Takeout, Delivery. D for Dine-In, T for Takeout, C for Delivery. |String
daypart|Breakfast 6 am - 10 am, Lunch 11 am - 2 pm, PM Snack 3 pm - 6pm, Dinner 7 pm - 10 pm, Graveyard 12 am - 5 am|String
payment_name|name of payment method|String
department_name|department of item in the pos machine|String
hour|hour of transaction|Integer
month|month of transaction|Integer
year|year of transaction|Integer
product_name|name of product|String
category|product's categorization according to marketing|String
branch|branch of transaction|String

## Responsibilities
You are to aid Business Intelligence in updating the pertinent data reports, optimizing middleware codebases, and facilitating data updates.

## Tasks for Week 1
Assist Sir Don Curativo in rebuilding the 2025 data for the Cloud Server, as well as optimize the Master Data compiler script.

## Assistance
If you need help, guidance, or clarification you can consult with me or Sir Don Curativo through the Internship GC as you learn and familiarize yourself with the work involved.

Good Luck 👍

> Written with [StackEdit](https://stackedit.io/).


