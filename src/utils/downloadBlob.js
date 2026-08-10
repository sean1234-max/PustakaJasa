// The only DOM-touching piece of the export flow — there's no backend in
// this prototype, so a client-side Blob download is the entire mechanism.
export function downloadTextFile(filename, text, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
