import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideDuasFormas() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            CRIAR <span>/</span> DUAS FORMAS
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">DUAS FORMAS DE CRIAR</span> · escolha a sua
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 46, maxWidth: 1540 }}
          >
            Na mão ou no automático — <em>os dois terminam igual</em>: um
            rascunho pra você publicar.
          </h2>
        </div>

        <div
          className={styles.stepsGrid}
          style={{
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
            alignContent: "center",
            gridAutoRows: "max-content",
          }}
        >
          <div className="step-card muted">
            <div className="head">
              <span>Manual</span>
              <span className="ix">CAMINHO A</span>
            </div>
            <div className="meta-row">
              <span className="tag">Você conduz</span>
              <span className="tag">Sem setup</span>
            </div>
            <div className="body">
              <p>
                Você cria o review da semana, linka as fontes e monta o report
                com a ajuda da Vitoria no chat. Controle total, passo a passo —
                bom pra projetos sem Granola ou quando você quer no detalhe.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Termina em</div>
              <div className="note">Rascunho → você publica</div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Automação · Granola</span>
              <span className="ix">CAMINHO B</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Recomendado</span>
              <span className="tag">O jeito fácil</span>
            </div>
            <div className="body">
              <p>
                A folder do projeto já está integrada. Você joga as transcrições
                na pasta do Granola e a Vitoria monta o rascunho sozinha, em dias
                úteis. Você só revisa e publica.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Termina em</div>
              <div className="note">Rascunho → você publica</div>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>
              Em qualquer caminho, nada vira verdade até você publicar.
            </span>
          </div>
          <div>Rascunho → Publicado</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · PM REVIEW · DUAS FORMAS" num="04 / 10" />
    </>
  );
}
