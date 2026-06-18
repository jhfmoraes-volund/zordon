import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideManual() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            MANUAL <span>/</span> VOCÊ NO CONTROLE
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">CAMINHO MANUAL</span> · sem automação, passo a
            passo
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 46, maxWidth: 1540 }}
          >
            Prefere na mão? <em>Quatro passos</em> e o report sai do mesmo jeito.
          </h2>
        </div>

        <div
          className={styles.stepsGrid}
          style={{
            gridTemplateColumns: "repeat(4, 1fr)",
            alignContent: "center",
            gridAutoRows: "max-content",
          }}
        >
          <div className="step-card">
            <div className="head">
              <span>Novo ritual</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag">Apps · Cerimônias</span>
            </div>
            <div className="body">
              <p>
                Em Apps → Cerimônias, clique <strong>&ldquo;Novo
                ritual&rdquo;</strong> e escolha <strong>PM Review</strong>.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Resultado</div>
              <div className="note">Formulário aberto</div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Semana + facilitador</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag">Formulário</span>
            </div>
            <div className="body">
              <p>
                Escolha a semana de referência (trava na segunda-feira) e, se
                quiser, o facilitador. Clique &ldquo;Criar PM Review&rdquo;.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Resultado</div>
              <div className="note">Rascunho criado</div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Monte o report</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Vitoria · chat</span>
            </div>
            <div className="body">
              <p>
                Abre o command center. Linke fontes, adicione notes ou peça pra
                Vitoria sintetizar o report no chat.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Resultado</div>
              <div className="note">Report montado</div>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>Revise e publique</span>
              <span className="ix">04</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Decisão humana</span>
            </div>
            <div className="body">
              <p>
                Leia, ajuste e publique. Mesma régua do automático: só o
                publicado vale.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Resultado</div>
              <div className="note">Review publicado</div>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>
              Manual e automático não se excluem: dá pra criar na mão e, depois,
              ligar a automação no mesmo projeto.
            </span>
          </div>
          <div>Um por semana, por projeto</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · PM REVIEW · MANUAL" num="07 / 10" />
    </>
  );
}
