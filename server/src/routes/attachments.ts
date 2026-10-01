import { Router, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { uploadAttachmentFile, getAttachmentDownloadStreamOrUrl } from '../services/s3Service';
import { logAuditEvent } from '../services/audit';

const router = Router();
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// POST /api/attachments/upload
router.post('/upload', authenticateToken, upload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file attached to upload request' });
    }

    const { parent_type, parent_id } = req.body;
    if (!parent_type || !parent_id) {
      return res.status(400).json({ error: 'parent_type and parent_id are required' });
    }

    if (!['PURCHASE_RECEIPT', 'STOCK_ADJUSTMENT', 'CHEMICAL_ISSUE', 'OPENING_STOCK'].includes(parent_type)) {
      return res.status(400).json({ error: 'Invalid parent_type' });
    }

    const result = await uploadAttachmentFile(req.file);

    const attachmentId = uuidv4();
    await query(
      `INSERT INTO attachments (
        id, parent_type, parent_id, object_key, original_filename, mime_type, size_bytes, uploaded_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attachmentId, parent_type, parent_id, result.objectKey,
        req.file.originalname, result.mimeType, result.sizeBytes, req.user?.id
      ]
    );

    await logAuditEvent({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: 'ATTACHMENT_UPLOADED',
      recordRef: `${parent_type.toLowerCase()}s/${parent_id}`,
      changedValues: { filename: req.file.originalname, sizeBytes: result.sizeBytes },
    });

    return res.status(201).json({
      id: attachmentId,
      object_key: result.objectKey,
      original_filename: req.file.originalname,
      mime_type: result.mimeType,
      size_bytes: result.sizeBytes,
      message: 'Attachment uploaded successfully'
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/attachments/:id/download
router.get('/:id/download', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await query(`SELECT * FROM attachments WHERE id = ?`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment record not found' });
    }

    const att = result.rows[0];
    const streamOrUrl = await getAttachmentDownloadStreamOrUrl(att.object_key);

    if (streamOrUrl.url) {
      return res.redirect(streamOrUrl.url);
    } else if (streamOrUrl.buffer) {
      res.setHeader('Content-Type', att.mime_type);
      res.setHeader('Content-Disposition', `inline; filename="${att.original_filename}"`);
      return res.send(streamOrUrl.buffer);
    }

    return res.status(404).json({ error: 'File content missing' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
