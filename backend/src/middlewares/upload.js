import multer from 'multer';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 5 }
});

function getImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function validateUploadedImages(req, res, next) {
  const files = req.files || [];
  if (files.length > 5) {
    return res.status(400).send({
      success: false,
      statusCode: 400,
      body: 'Envie no máximo cinco fotografias por produto.'
    });
  }

  const invalidFile = files.find((file) =>
    file.size > MAX_FILE_SIZE || !getImageType(file.buffer)
  );
  if (invalidFile) {
    const body = invalidFile.size > MAX_FILE_SIZE
      ? 'Cada fotografia deve ter no máximo 5 MB.'
      : 'Formato de imagem inválido. Envie arquivos JPEG, PNG ou WEBP válidos.';
    return res.status(400).send({ success: false, statusCode: 400, body });
  }

  return next();
}