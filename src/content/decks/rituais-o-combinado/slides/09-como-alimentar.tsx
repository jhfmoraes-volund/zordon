import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideComoAlimentar() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            COMO ALIMENTAR <span>/</span> NA PRÁTICA
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">NA PRÁTICA</span> · da fonte externa à decisão
            interna
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 48, maxWidth: 1500 }}
          >
            Alimentar um ritual são <em>quatro passos</em>.
          </h2>
        </div>

        <div
          className={styles.stepsGrid}
          style={{ gridTemplateColumns: "repeat(4, 1fr)" }}
        >
          <div className="step-card muted">
            <div className="head">
              <span>Linkar fontes</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag">Entrada</span>
            </div>
            <div className="body">
              <p>
                Conecte ao ritual as reuniões (Granola / transcrições), Notion,
                Drive e planilhas. O SSOT pode morar fora — só precisa estar
                linkado.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">Fontes e transcrições anexadas</div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Vitoria lê</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Agente</span>
            </div>
            <div className="body">
              <p>
                A Vitoria lê o contexto linkado mais o estado do projeto —
                sprint, board e decisões anteriores.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">Contexto consolidado</div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Vitoria propõe</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Proposta</span>
            </div>
            <div className="body">
              <p>
                Ela propõe: plano de tasks (Planning), report estruturado (PM
                Review) ou ordem de roadmap (Release).
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">Rascunho pra revisão</div>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>PM aprova</span>
              <span className="ix">04</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Decisão humana</span>
            </div>
            <div className="body">
              <p>
                Você revisa, ajusta e aprova. Só então vira task, decisão e
                contexto interno. Nada publica sem aceite.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">Vira verdade interna</div>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · RITUAIS · COMO ALIMENTAR" num="09 / 10" />
    </>
  );
}
