import "../styles/footer.css";

export default function Footer() {
  return (
    <footer className="footer">
      <span className="footer-brand">Hiperia</span>
      <span className="footer-note">
        Test SOL only &middot; Transactions require a wallet signature
      </span>
      <a href="https://faucet.solana.com/" target="_blank" rel="noreferrer">
        Get test SOL <span aria-hidden="true">&#8599;</span>
      </a>
    </footer>
  );
}
