import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideModelo() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            MODELO MENTAL <span>/</span> AGENTE DENTRO DO APP
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">O PRINCÍPIO</span> · o agente opera, não só
            responde
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 48, maxWidth: 1500 }}
          >
            Ele <em>enxerga o estado</em> do app
            <br />e <em>age</em> nele — você aprova.
          </h2>
        </div>

        <div className={`${styles.stepsGrid} ${styles.stepsGridCols3}`}>
          <div className="step-card">
            <div className="head">
              <span>Enxerga</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Contexto</span>
            </div>
            <div className="body">
              <p>
                O agente lê o estado vivo do app onde está — a sprint, as tasks,
                a sessão, a página em que você está agora. Não adivinha.
              </p>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Age</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag">Ferramentas</span>
            </div>
            <div className="body">
              <p>
                Cada agente tem um conjunto de ferramentas do seu domínio — ler,
                propor, escrever. É só o que faz sentido pra aquele app.
              </p>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>Você decide</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag cliente">Humano no comando</span>
            </div>
            <div className="body">
              <p>
                Propostas (tasks, PRDs, planos) passam por você. O agente acelera
                o caminho — a decisão continua sua.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>Mesma UI pra todos os agentes — muda o domínio, não o jeito</span>
          </div>
          <div>Agente = motor do app</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · AGENTES · MODELO MENTAL" num="02 / 11" />
    </>
  );
}
