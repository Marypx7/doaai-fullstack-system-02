import { v2 as cloudinary } from 'cloudinary';
import { config } from 'dotenv';

config();

const credentials = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
};

export const isCloudinaryConfigured = Object.values(credentials).every(Boolean);

if (isCloudinaryConfigured) {
  cloudinary.config(credentials);
}

export default cloudinary;