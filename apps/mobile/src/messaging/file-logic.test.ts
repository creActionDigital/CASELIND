import { describe, expect, it } from 'vitest';
import { documentMime, fileKind, formatFileSize, isDocumentMime } from './file-logic';

describe('file-logic', () => {
  it('resolves the mime from the declared type or the extension', () => {
    expect(documentMime('application/pdf', 'a.pdf')).toBe('application/pdf');
    expect(documentMime('application/octet-stream', 'Rapport.DOCX')).toContain('wordprocessingml');
    expect(documentMime(undefined, 'setup.exe')).toBeNull();
    expect(documentMime('image/png', 'a.png')).toBeNull();
  });
  it('classifies and formats', () => {
    expect(fileKind('application/pdf')).toBe('pdf');
    expect(fileKind('application/msword')).toBe('word');
    expect(isDocumentMime('image/png')).toBe(false);
    expect(isDocumentMime('application/pdf')).toBe(true);
    expect(formatFileSize(2_097_152)).toBe('2.0 Mo');
    expect(formatFileSize(10)).toBe('1 Ko');
  });
});
