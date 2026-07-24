import { PDFDocument } from 'pdf-lib';

import type { BusinessProfile } from '../types';

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;
const LEFT_MARGIN = 50;
const TITLE_Y = 750;
const BUSINESS_Y = 700;
const EIN_Y = 680;
const OLD_ADDRESS_Y = 640;
const NEW_ADDRESS_Y = 620;

/**
 * Builds a minimal IRS 8822-B PDF preview with the business name, EIN, and
 * old/new address fields placed in a fixed top-of-page layout.
 */
export const generate8822B = async (data: BusinessProfile) => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  page.drawText('IRS FORM 8822-B', { x: LEFT_MARGIN, y: TITLE_Y });
  page.drawText(`Business: ${data.legalName}`, { x: LEFT_MARGIN, y: BUSINESS_Y });
  page.drawText(`EIN: ${data.ein}`, { x: LEFT_MARGIN, y: EIN_Y });
  page.drawText(`Old Address: ${data.oldAddress}`, { x: LEFT_MARGIN, y: OLD_ADDRESS_Y });
  page.drawText(`New Address: ${data.newAddress}`, { x: LEFT_MARGIN, y: NEW_ADDRESS_Y });

  return pdf.save();
};
