import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function SlidePacto() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            O PACTO <span>/</span> REGRA DE OURO
          </>
        }
      />
      <Crosshairs />

      <div className={`${styles.stage} ${styles.coverStage}`}>
        <Eyebrow>
          <span className="pri">O COMBINADO</span> · o que assumimos juntos
        </Eyebrow>
        <h1
          className={styles.titleH1}
          style={{ marginTop: 28, fontSize: 84, maxWidth: 1560 }}
        >
          Todo ritual sob sua responsabilidade
          <br />
          está <em>sempre em dia</em>.
        </h1>
        <p className={styles.lede} style={{ marginTop: 28 }}>
          Não é relatório pra gestão — é como o projeto enxerga a si mesmo.
          Ritual vazio é ponto cego, e ponto cego em operação custa caro. Seja
          semanal, mensal ou uma vez por projeto, cada um faz a sua parte.
        </p>

        <div className={styles.metaRow}>
          <div>
            <div className="k">Sempre em dia</div>
            <div className="v">
              <span className="accent">Não opcional</span>{" "}
              <span className="quiet">— faz parte do trabalho</span>
            </div>
          </div>
          <div>
            <div className="k">Cada um faz sua parte</div>
            <div className="v">PM e Head Ops, sem terceirizar</div>
          </div>
          <div>
            <div className="k">Procedência clicável</div>
            <div className="v">Toda nota rastreia a fonte</div>
          </div>
          <div>
            <div className="k">Sem TBD</div>
            <div className="v">Decisão fechada, não rascunho</div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · RITUAIS · O PACTO" num="03 / 10" />
    </>
  );
}
