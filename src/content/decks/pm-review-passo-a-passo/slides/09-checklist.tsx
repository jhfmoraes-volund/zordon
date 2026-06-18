import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideChecklist() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            CHECKLIST <span>/</span> TODA SEMANA
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 28, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">CHECKLIST DA SEMANA</span> · cinco gestos, em
            todo projeto
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 48, maxWidth: 1520 }}
          >
            Seu ritual da semana, em <em>cinco gestos</em>.
          </h2>
        </div>

        <div className={styles.dividerAgenda} style={{ flex: 1 }}>
          <div className="label">Repita toda semana, em cada projeto seu</div>
          <ul>
            <li>
              <span className="ix">01</span>
              <span className="nm">Jogue as notas na folder do Granola</span>
              <span className="tg">Hábito</span>
            </li>
            <li>
              <span className="ix">02</span>
              <span className="nm">Abra o rascunho da semana</span>
              <span className="tg">Revisão</span>
            </li>
            <li>
              <span className="ix">03</span>
              <span className="nm">Ajuste o que a Vitoria escreveu</span>
              <span className="tg">Edição</span>
            </li>
            <li>
              <span className="ix">04</span>
              <span className="nm">Publique — terça a sexta</span>
              <span className="tg">Prazo</span>
            </li>
            <li>
              <span className="ix">05</span>
              <span className="nm">Na segunda, começa de novo</span>
              <span className="tg">Cadência</span>
            </li>
          </ul>
        </div>
      </div>

      <SlideFooter left="VOLUND · PM REVIEW · CHECKLIST" num="09 / 10" />
    </>
  );
}
