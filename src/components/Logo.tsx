import { Link } from "react-router-dom";

export default function Logo() {
  return (
    <Link to="/" className="logo" aria-label="party.fun home">
      <span className="logo-mark">p</span>
      <span>
        party<span>.fun</span>
      </span>
    </Link>
  );
}
