export async function handler(req, res) {
  res.status(501).json({
    error: 'Implement with your preferred OCR/Vision provider. Keep keys server-side.'
  });
}