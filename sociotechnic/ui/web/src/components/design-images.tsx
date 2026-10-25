import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "./ui/button";

export type DraftImage = { id: string; name: string; mediaType: string; data: string };

export function DesignImages({ images, onChange, onError, onLoading, disabled, children }: {
  images: DraftImage[]; onChange: (images: DraftImage[]) => void; onError: (message: string | null) => void;
  onLoading: (loading: boolean) => void; disabled: boolean; children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  async function attach(files: File[]) {
    if (disabled || loading || !files.length) return;
    onError(null);
    if (images.length + files.length > 8) { onError("Attach up to eight images per message."); return; }
    if (files.some((file) => !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)) { onError("Use PNG, JPEG, GIF or WebP images under 5 MB each."); return; }
    setLoading(true); onLoading(true);
    try {
      const added = await Promise.all(files.map((file) => new Promise<DraftImage>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(`Cannot read ${file.name}.`));
        reader.onload = () => typeof reader.result === "string" ? resolve({ id: crypto.randomUUID(), name: file.name.slice(0, 180), mediaType: file.type, data: reader.result.slice(reader.result.indexOf(",") + 1) }) : reject(new Error(`Cannot read ${file.name}.`));
        reader.readAsDataURL(file);
      })));
      onChange([...images, ...added]);
    } catch (error) { onError(error instanceof Error ? error.message : "Cannot read the selected images."); }
    finally { setLoading(false); onLoading(false); if (input.current) input.current.value = ""; }
  }
  return <div className="form-stack design-image-composer" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); void attach(Array.from(event.dataTransfer.files)); }} onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void attach(files); } }}>
    {children}
    {images.length ? <ul className="design-image-drafts" aria-label="Attached images">{images.map((image) => <li key={image.id}><img src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} width={96} height={80} /><span>{image.name}</span><Button type="button" variant="ghost" size="icon" aria-label={`Remove ${image.name}`} disabled={disabled || loading} onClick={() => onChange(images.filter((item) => item.id !== image.id))}><X size={16} /></Button></li>)}</ul> : null}
    <div className="action-row"><input hidden ref={input} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Choose reference images" disabled={disabled || loading} onChange={(event) => void attach(Array.from(event.target.files ?? []))} /><Button type="button" variant="outline" disabled={disabled || loading} onClick={() => input.current?.click()}><ImagePlus size={16} /> {loading ? "Reading images…" : "Attach images"}</Button><span className="technical-description">Paste or drop images here · up to 5 MB each</span></div>
  </div>;
}
