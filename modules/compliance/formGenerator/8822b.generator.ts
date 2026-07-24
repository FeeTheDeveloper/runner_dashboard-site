import { PDFDocument } from 'pdf-lib';

import type { BusinessProfile } from '../types';

export const generate8822B = async (data: BusinessProfile) => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);

  page.drawText('IRS FORM 8822-B', { x: 50, y: 750 });
  page.drawText(`Business: ${data.legalName}`, { x: 50, y: 700 });
  page.drawText(`EIN: ${data.ein}`, { x: 50, y: 680 });
  page.drawText(`Old Address: ${data.oldAddress}`, { x: 50, y: 640 });
  page.drawText(`New Address: ${data.newAddress}`, { x: 50, y: 620 });

  return pdf.save();
};
