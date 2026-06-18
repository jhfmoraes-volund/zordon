import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

const BLOCKS: { n: string; name: string; desc: string }[] = [
  { n: "01", name: "Panorama", desc: "Resumo da semana: onde o projeto está agora." },
  { n: "02", name: "Rumo do projeto", desc: "A direção — pra onde estamos indo." },
  { n: "03", name: "Marco", desc: "Entregas e marcos que aconteceram ou se aproximam." },
  { n: "04", name: "Próximos passos", desc: "As ações da próxima semana." },
  {
    n: "05",
    name: "Riscos",
    desc: "O que pode dar errado, com a postura: mitigando, ação necessária ou escalar.",
  },
  { n: "06", name: "Necessidades", desc: "Recursos e insumos pendentes pra destravar o time." },
  { n: "07", name: "Indicadores do time", desc: "Capacidade, moral e bloqueios do time." },
  { n: "08", name: "Decisões em aberto", desc: "Decisões que precisam de uma resposta." },
];

export function SlideAnatomia() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            O REPORT <span>/</span> O QUE A VITORIA ENTREGA
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 22, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">ANATOMIA DO REPORT</span> · oito blocos,
            sempre os mesmos
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 46, maxWidth: 1520 }}
          >
            O report tem <em>forma fixa</em> — a Vitoria preenche, você revisa.
          </h2>
        </div>

        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "repeat(4, max-content)",
            gridAutoFlow: "column",
            columnGap: 96,
            alignContent: "center",
          }}
        >
          {BLOCKS.map((b) => (
            <div
              key={b.n}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                columnGap: 22,
                alignItems: "baseline",
                padding: "20px 0",
                borderBottom: "1px solid oklch(1 0 0 / 8%)",
              }}
            >
              <span
                style={{
                  font: "500 14px/1 var(--font-mono)",
                  color: "var(--brand)",
                  letterSpacing: "0.18em",
                  fontFeatureSettings: '"tnum" 1',
                }}
              >
                {b.n}
              </span>
              <div>
                <div
                  style={{
                    font: "600 27px/1.1 var(--font-sans)",
                    color: "oklch(0.95 0 0)",
                    letterSpacing: "-0.015em",
                  }}
                >
                  {b.name}
                </div>
                <div
                  style={{
                    font: "400 15px/1.45 var(--font-sans)",
                    color: "oklch(0.6 0 0)",
                    marginTop: 9,
                    maxWidth: 620,
                  }}
                >
                  {b.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.durationBar} style={{ margin: "4px 0 0" }}>
          <div className="l">
            <span>
              Cada bloco vem com as fontes que o sustentam — reunião, nota,
              transcrição. Sem fonte, não publica.
            </span>
          </div>
          <div>Report rastreável</div>
        </div>
      </div>

      <SlideFooter left="VOLUND · PM REVIEW · O REPORT" num="03 / 10" />
    </>
  );
}
