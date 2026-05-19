import type { ReactNode } from "react";
import styles from "./deck.module.css";

export function Masthead({
  brand,
  section,
}: {
  brand: ReactNode;
  section: ReactNode;
}) {
  return (
    <div className={styles.masthead}>
      <div className="brand">{brand}</div>
      <div className="section">{section}</div>
    </div>
  );
}

export function SlideFooter({
  left,
  num,
}: {
  left: ReactNode;
  num: string;
}) {
  return (
    <div className={styles.footer}>
      <div>{left}</div>
      <div className="num">{num}</div>
    </div>
  );
}

export function Crosshairs() {
  return (
    <>
      <div className={`${styles.crosshair} ${styles.crosshairTl}`} />
      <div className={`${styles.crosshair} ${styles.crosshairTr}`} />
      <div className={`${styles.crosshair} ${styles.crosshairBl}`} />
      <div className={`${styles.crosshair} ${styles.crosshairBr}`} />
    </>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className={styles.eyebrow}>{children}</div>;
}

export function BrandTag() {
  return (
    <>
      <span className="dot" />
      <b>VOLUND</b> · ZORDON
    </>
  );
}
