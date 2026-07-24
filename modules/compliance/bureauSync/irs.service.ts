export const submitIRS = async (document: Uint8Array) => ({
  bureau: 'IRS',
  status: 'submitted' as const,
  method: 'manual/mail' as const,
  documentSize: document.byteLength,
  timestamp: new Date(),
});

export const irsService = {
  sync: submitIRS,
};
