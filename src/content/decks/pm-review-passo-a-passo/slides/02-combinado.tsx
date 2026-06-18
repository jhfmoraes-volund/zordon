import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideCombinado() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            O COMBINADO <span>/</span> A REGRA DA SEMANA
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">O COMBINADO</span> · não é burocracia, é
            visibilidade
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 48, maxWidth: 1520 }}
          >
            Cada PM publica <em>um PM Review por semana</em>, em cada projeto
            seu.
          </h2>
        </div>

        <div
          className={styles.stepsGrid}
          style={{
            gridTemplateColumns: "repeat(4, 1fr)",
            alignContent: "center",
            gridAutoRows: "minmax(230px, max-content)",
          }}
        >
          <div className="step-card">
            <div className="head">
              <span>Quando</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag">Cadência</span>
            </div>
            <div className="body">
              <p>
                Um por semana, referência na segunda-feira. Janela pra deixar
                publicado: <strong>terça a sexta</strong>.
              </p>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Quem</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Responsável</span>
            </div>
            <div className="body">
              <p>
                É você, PM, em cada projeto que lidera. Ninguém publica o review
                no seu lugar.
              </p>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Por quê</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag">Visibilidade</span>
            </div>
            <div className="body">
              <p>
                Sem o review da semana, a liderança e o Zordon ficam cegos ao
                rumo do projeto.
              </p>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>O que conta</span>
              <span className="ix">04</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Fonte de verdade</span>
            </div>
            <div className="body">
              <p>
                Rascunho não vale. O último review <strong>publicado</strong> é
                a verdade da semana.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>
              A regra em uma linha: terça a sexta, um PM Review publicado por
              projeto.
            </span>
          </div>
          <div>Sempre em dia</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · PM REVIEW · O COMBINADO" num="02 / 10" />
    </>
  );
}
