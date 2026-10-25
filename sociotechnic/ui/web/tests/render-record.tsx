import { renderToStaticMarkup } from "react-dom/server";
import RecordContent from "../src/components/record-content";
export function renderRecord(path: string, text: string, raw = false) {
  return renderToStaticMarkup(<RecordContent path={path} text={text} raw={raw} />);
}
