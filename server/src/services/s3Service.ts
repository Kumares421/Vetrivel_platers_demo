import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const S3_REGION = process.env.S3_REGION || 'us-east-1';
const S3_BUCKET = process.env.S3_BUCKET || 'vetrivel-attachments';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'minioadmin';

let s3Client: S3Client | null = null;
let useLocalDisk = false;

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

try {
  s3Client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: {
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
    },
    forcePathStyle: true,
  });
} catch (e) {
  console.warn('S3 Client initialization fallback to local storage');
  useLocalDisk = true;
}

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export async function uploadAttachmentFile(file: Express.Multer.File): Promise<{ objectKey: string; sizeBytes: number; mimeType: string }> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File size exceeds maximum allowed limit of 10 MB');
  }

  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new Error('Invalid file type. Only PDF, JPEG, and PNG files are accepted');
  }

  const ext = path.extname(file.originalname);
  const objectKey = `attachments/${uuidv4()}${ext}`;

  if (!useLocalDisk && s3Client) {
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: objectKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          Metadata: {
            originalFilename: file.originalname,
          },
        })
      );
    } catch (err) {
      console.warn('S3 Upload failed, saving to local disk fallback:', err);
      const filePath = path.join(UPLOAD_DIR, objectKey.replace(/\//g, '_'));
      fs.writeFileSync(filePath, file.buffer);
    }
  } else {
    const filePath = path.join(UPLOAD_DIR, objectKey.replace(/\//g, '_'));
    fs.writeFileSync(filePath, file.buffer);
  }

  return {
    objectKey,
    sizeBytes: file.size,
    mimeType: file.mimetype,
  };
}

export async function getAttachmentDownloadStreamOrUrl(objectKey: string): Promise<{ url?: string; buffer?: Buffer; mimeType?: string }> {
  if (!useLocalDisk && s3Client) {
    try {
      const command = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: objectKey,
      });
      const url = await getSignedUrl(s3Client, command, { expiresIn: 900 });
      return { url };
    } catch (err) {
      console.warn('S3 presigned URL generation failed, searching local fallback');
    }
  }

  const filePath = path.join(UPLOAD_DIR, objectKey.replace(/\//g, '_'));
  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);
    return { buffer };
  }

  throw new Error('Attachment file not found');
}
