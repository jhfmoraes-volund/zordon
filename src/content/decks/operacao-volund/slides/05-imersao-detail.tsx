import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function Slide05ImersaoDetail() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            FASE 01 · IMERSÃO <span>/</span> ETAPAS
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 18, paddingTop: 28 }}>
        <div>
          <Eyebrow>
            <span className="pri">FASE 01 · IMERSÃO</span> · 4 dias úteis · 6
            etapas
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 16, fontSize: 48, maxWidth: 1500 }}
          >
            Do <em>comercial</em> ao <em>alinhamento final</em>
            <br />
            com o cliente.
          </h2>
        </div>

        <div className={styles.durationBar}>
          <div className="l">
            <span>4 dias úteis</span>
          </div>
          <div>D1 · D2 · — · D4</div>
        </div>

        <div className={`${styles.stepsGrid} ${styles.stepsGridCols6}`}>
          <div className="step-card muted">
            <div className="head">
              <span>Comercial</span>
              <span className="ix">01</span>
            </div>
            <div className="meta-row">
              <span className="tag">Pré-venda</span>
            </div>
            <div className="body">
              <p>
                Agendas comerciais com os potenciais clientes. Alinhamento de
                escopo, objetivos e expectativas iniciais.
              </p>
            </div>
            <div className="outputs empty">
              <div className="ot">Output</div>
              <div className="note">Pipeline qualificado</div>
            </div>
          </div>

          <div className="step-card muted">
            <div className="head">
              <span>Proposta</span>
              <span className="ix">02</span>
            </div>
            <div className="meta-row">
              <span className="tag">Pré-venda</span>
            </div>
            <div className="body">
              <p>
                Formalização de uma proposta para o cliente, com orçamento
                estimando o esforço em FP (Function Points).
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">Aceite da proposta</div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>KickOff</span>
              <span className="ix">03</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Dia 1</span>
              <span className="tag cliente">Cliente</span>
            </div>
            <div className="body">
              <p>
                Reunião de alinhamento inicial, apresentação do time, rituais
                e cronograma macro.
              </p>
              <p>
                Alinhamento dos resultados esperados e mapeamento de riscos.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">
                Alinhamento de premissas, agendas com o time + cronograma de
                imersão
              </div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Design Session</span>
              <span className="ix">04</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Dia 2</span>
              <span className="tag cliente">Cliente</span>
            </div>
            <div className="body">
              <p>
                Sessão de design para entender a jornada do usuário,
                necessidades de funcionalidade, prioridades e regras de
                negócio.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">Briefing completo com detalhes do escopo</div>
            </div>
          </div>

          <div className="step-card refino">
            <div className="head">
              <span>Requisitos e Refino</span>
              <span className="ix">05</span>
            </div>
            <div className="meta-row">
              <span className="tag interno">Interno</span>
              <span className="tag">Se precisar</span>
            </div>
            <div className="body">
              <p>
                Processo interno onde o PM organiza com a Squad o compilado
                completo de tasks, requisitos e regras de negócio.
              </p>
              <p>
                Usa IA para extrair todos os requisitos em formato de
                cronograma e tasks com base na Design Session.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">
                Cronograma + escopo refinado · revisão de tasks
              </div>
            </div>
          </div>

          <div className="step-card">
            <div className="head">
              <span>Alinhamento Final</span>
              <span className="ix">06</span>
            </div>
            <div className="meta-row">
              <span className="tag brand">Dia 4</span>
              <span className="tag cliente">Cliente</span>
            </div>
            <div className="body">
              <p>
                Com tasks, requisitos, escopo e cronograma definidos,
                alinhamos uma última vez antes de seguir para operação.
              </p>
            </div>
            <div className="outputs">
              <div className="ot">Output</div>
              <div className="note">Aceite do cliente para iniciar a operação</div>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · OPERAÇÃO · FASE 01" num="05 / 10" />
    </>
  );
}
