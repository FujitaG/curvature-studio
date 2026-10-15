import { t } from '../i18n';

export interface FileFailure { filename: string; message: string }
export function fileFailure(file: File, error: unknown): FileFailure {
  const message = error instanceof SyntaxError ? 'This is not valid JSON. Check the file syntax, then select it again.'
    : error instanceof TypeError || error instanceof RangeError ? 'The file contains invalid or unsupported fields. Check its format and values, then select the corrected file.'
    : error instanceof Error ? error.message : 'The file could not be read. Try selecting it again.';
  return { filename: file.name, message };
}
/** Errors stay available until dismissed or another file is selected. */
export function FileErrorNotice({ failure, onDismiss, className = '', unchanged = true }: { failure: FileFailure; onDismiss: () => void; className?: string; unchanged?: boolean }) {
  return <div className={`file-error panel ${className}`} role="alert">
    <div className="file-error-copy">
      <strong>{t('Could not open file')}</strong>
      <span className="file-error-name">{failure.filename}</span>
      <p>{t(failure.message)}</p>
      {unchanged ? <p className="file-error-retained">{t('Your current work has not been changed.')}</p> : null}
    </div>
    <button className="button" onClick={onDismiss}>{t('Dismiss')}</button>
  </div>;
}
