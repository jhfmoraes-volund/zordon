import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlideAutomacaoSetup() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            AUTOMAÇÃO <span>/</span> COMO FUNCIONA
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">AUTOMAÇÃO · GRANOLA</span> · o que já está
            pronto, o que é com você
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 46, maxWidth: 1540 }}
          >
            A folder do projeto <em>já está integrada</em>. Sua parte é
            alimentar o Granola.
          </h2>
        </div>

        <div
          className={`${styles.stepsGrid} ${styles.stepsGridCols3}`}
          style={{ alignContent: "center", gridAutoRows: "max-content" }}
        >
          <div className="step-card muted">
            <div className="head">
              <span>Já está pronto</span>
              <span className="ix">NÃO É COM VOCÊ</span>
            </div>
            <div className="meta-row">
              <span className="tag">Pré-configurado</span>
            </div>
            <div className="body">
              <p>
                A folder do projeto já está vinculada ao Granola. E a integração
                em Configurações cuida de insumos e reuniões — é outro fluxo, já
                no lugar.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Estado</div>
              <div className="note">Folder do projeto integrada</div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>É com você</span>
              <span className="ix">SEU PAPEL</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Dentro do Granola</span>
            </div>
            <div className="body">
              <p>
                Compartilhe as transcrições das reuniões na pasta do projeto,
                dentro do Granola. É só isso que a automação pede de você.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Ação</div>
              <div className="note">Transcrições na pasta</div>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>Automático</span>
              <span className="ix">VITORIA</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Sem você</span>
            </div>
            <div className="body">
              <p>
                A Vitoria lê o que está na pasta e monta — ou atualiza — o
                rascunho do PM Review da semana, em dias úteis.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Resultado</div>
              <div className="note">Rascunho gerado</div>
            </div>
          </div>
        </div>

        <div className={styles.durationBar} style={{ margin: "8px 0 0" }}>
          <div className="l">
            <span>
              Ligar/desligar e a instrução da Vitoria moram na engrenagem de
              Cerimônias — config única do projeto, não rotina.
            </span>
          </div>
          <div>Roda em dias úteis · ~08h (BRT)</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · PM REVIEW · AUTOMAÇÃO" num="05 / 10" />
    </>
  );
}
