const express = require('express');
const router = express.Router();

const fetchController = require('../controllers/fetchController');
const authMiddleware = require('../middleware/authMiddleware');
const FileRecord = require('../models/fileRecordModel');

router.get('/status/stream', authMiddleware.protectWithQueryToken, fetchController.streamStatus);
router.post('/start', authMiddleware.protect, fetchController.startFetch);
router.post('/start-from-log', authMiddleware.protect, fetchController.startFromLog);
router.post('/missing', authMiddleware.protect, fetchController.startMissingFetch);
// debug endpoint (no auth) to test listRemoteFiles behavior
router.post('/debug-list', fetchController.debugList);

// List downloaded file records
router.get('/files', authMiddleware.protect, async (req, res) => {
	try {
		const { branch, pos, limit = 50, page = 1, startDate, endDate } = req.query || {};
		const query = {};
		if (branch) query.branch = branch;
		if (pos) query.pos = Number(pos);
		if (startDate || endDate) {
			const range = {};
			if (startDate) range.$gte = new Date(String(startDate));
			if (endDate) {
				const d = new Date(String(endDate));
				// include the endDate full day
				d.setHours(23, 59, 59, 999);
				range.$lte = d;
			}
			query.workDate = range;
		}

		const pageNumber = Math.max(1, Number(page) || 1);
		const pageLimit = Math.min(Math.max(1, Number(limit) || 50), 1000);

		const [items, total] = await Promise.all([
			FileRecord.find(query)
				.sort({ createdAt: -1 })
				.skip((pageNumber - 1) * pageLimit)
				.limit(pageLimit)
				.lean(),
			FileRecord.countDocuments(query),
		]);

		res.json({ items, total, page: pageNumber, pageSize: pageLimit });
	} catch (error) {
		res.status(500).json({ message: error && error.message ? error.message : String(error) });
	}
});

// Stream raw CSV file (from stored local path)
router.get('/files/:id/raw', authMiddleware.protect, fetchController.streamFileRaw);

// Stream parsed CSV rows as NDJSON (newline-delimited JSON)
// Query params: ?limit=100 (preview - buffer first N rows and return JSON array)
router.get('/files/:id/rows', authMiddleware.protect, fetchController.streamFileRows);

// Get parsed reports (stored rows)
router.get('/reports', authMiddleware.protect, fetchController.getReports);

// Get list of branches (distinct)
router.get('/branches', authMiddleware.protect, fetchController.getBranches);

// Manual fetch for a single date with branch list (client sends { date, branches, positions, files })
router.post('/manual', authMiddleware.protect, fetchController.manualFetch);

// Start combiner job: scans a workdir (e.g., 'latest') and runs combine/enrichment
router.post('/combine/start', authMiddleware.protect, fetchController.startCombine);
// Scan for missing branch/pos/date combinations in a workdir
router.post('/missing/scan', authMiddleware.protect, fetchController.scanMissing);

module.exports = router;
