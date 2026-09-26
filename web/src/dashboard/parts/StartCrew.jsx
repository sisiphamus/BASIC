import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useLive } from '../live.jsx';

function Qr({ url }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#14171c', light: '#ffffff' } }).then(setSvg, () => setSvg(''));
  }, [url]);
  return <div className="size-40 shrink-0 bg-white p-2 [&>svg]:h-full [&>svg]:w-full" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** How a crew gets onto the floor: scan the glasses page on the phone paired with the glasses. */
export default function StartCrew({ compact = false }) {
  const [{ health }] = useLive();
  const lan = health?.urls?.glasses || [];
  const urls = lan.length ? lan : [`${location.origin}/glasses`];
  return (
    <div className={`grid gap-6 ${compact ? '' : 'md:grid-cols-[auto_1fr]'} items-start`}>
      <div className="flex flex-wrap gap-4">
        {urls.slice(0, 2).map((u) => (
          <figure key={u} className="flex flex-col gap-2">
            <Qr url={u} />
            <figcaption className="max-w-40 break-all text-xs text-ink-2">{u}</figcaption>
          </figure>
        ))}
      </div>
      <div className="max-w-prose">
        <ol className="list-decimal space-y-2 pl-5 text-[0.9375rem] text-ink-2 marker:font-display marker:font-bold marker:text-ink">
          <li>Scan this with the phone paired to the crew's glasses.</li>
          <li>Enter the crew member's name and pick the job.</li>
        </ol>
        {!lan.length && <p className="mt-4 text-sm text-ink-3">No HTTPS link, so phones can't use the camera. Turn on the server's HTTPS port.</p>}
      </div>
    </div>
  );
}
