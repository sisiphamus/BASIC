import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="py-16">
      <h1 className="font-display text-[2.5rem] font-bold leading-none">Nothing here</h1>
      <p className="mt-3 text-ink-2">
        That page does not exist.{' '}
        <Link to="/" className="link text-ink">
          Back to the floor
        </Link>
      </p>
    </div>
  );
}
