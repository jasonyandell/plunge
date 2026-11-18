import { encodePicture, loadPicture } from './screenshot-client';
import { MAX_SCREENSHOT_EDGE, type ScreenshotUpload } from './screenshots';

// Snapshot the rendered app, without leaving the game or asking for screen sharing.
// Form values and embedded pages are deliberately omitted from the picture.
export async function captureScreen(): Promise<ScreenshotUpload> {
  const width = innerWidth, height = innerHeight;
  const copy = (source: Element): Element => {
    const target = source.cloneNode(false) as HTMLElement | SVGElement;
    for (const attribute of Array.from(target.attributes)) {
      if (attribute.name !== 'viewBox' && !['d', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'transform', 'points', 'xmlns'].includes(attribute.name)) target.removeAttribute(attribute.name);
    }
    const style = getComputedStyle(source);
    for (const property of style) {
      const value = style.getPropertyValue(property);
      // External resources cannot be loaded safely inside a self-contained SVG.
      if (!value.includes('url(')) target.style.setProperty(property, value);
    }
    target.style.animation = 'none';
    target.style.transition = 'none';
    if (source.matches('script,style,link,iframe,video,object,embed,[data-idea-tools]')) {
      target.style.visibility = 'hidden';
      return target;
    }
    if (source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement || source instanceof HTMLSelectElement) return target;
    if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
        canvas.height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
        canvas.getContext('2d')!.drawImage(source, 0, 0);
        const image = document.createElement('img');
        image.style.cssText = target.style.cssText;
        image.src = canvas.toDataURL();
        return image;
      } catch { target.style.visibility = 'hidden'; return target; }
    }
    for (const child of source.childNodes) {
      if (child instanceof Element) target.appendChild(copy(child));
      else if (child.nodeType === Node.TEXT_NODE) target.appendChild(child.cloneNode());
    }
    if (source instanceof HTMLElement && (source.scrollTop || source.scrollLeft)) {
      const contents = document.createElement('div');
      contents.style.transform = `translate(${-source.scrollLeft}px, ${-source.scrollTop}px)`;
      contents.append(...Array.from(target.childNodes));
      target.appendChild(contents);
    }
    return target;
  };
  const page = copy(document.body) as HTMLElement;
  page.style.width = `${width}px`;
  page.style.height = `${height}px`;
  page.style.margin = '0';
  page.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(page)}</foreignObject></svg>`;
  const image = await loadPicture(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const scale = Math.min(1, MAX_SCREENSHOT_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#43291a';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return encodePicture(canvas);
}
