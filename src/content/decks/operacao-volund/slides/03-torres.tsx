import styles from "@/components/deck/deck.module.css";
import {
  BrandTag,
  Crosshairs,
  Eyebrow,
  Masthead,
  SlideFooter,
} from "@/components/deck/slide-primitives";

export function Slide03Torres() {
  return (
    <>
      <Masthead
        brand={<BrandTag />}
        section={
          <>
            TIME <span>/</span> TORRES DE ESPECIALIDADE
          </>
        }
      />
      <Crosshairs />

      <div className={styles.stage} style={{ gap: 28, paddingTop: 36 }}>
        <div>
          <Eyebrow>
            <span className="pri">ESTRUTURA DO TIME</span> · product builders +
            torres de apoio
          </Eyebrow>
          <h2
            className={styles.titleH2}
            style={{ marginTop: 22, maxWidth: 1400 }}
          >
            Cada projeto opera sobre um <em>Product Builder</em>
            <br />
            apoiado por cinco torres de especialidade.
          </h2>
        </div>

        <div className={styles.torresGrid}>
          {/* Core */}
          <div className={styles.coreStack}>
            <div className="core-head">
              <div className="ttl">Habilidades Core do Product Builder</div>
              <div className="sub">· starter kit</div>
            </div>
            <div className="core-pills">
              <div className="core-pill fe">
                <span className="ix">01</span>Frontend
              </div>
              <div className="core-pill be">
                <span className="ix">02</span>Backend
              </div>
              <div className="core-pill se">
                <span className="ix">03</span>Security
              </div>
              <div className="core-pill ai">
                <span className="ix">04</span>AI First
              </div>
            </div>
            <div className="core-foot">
              Toda pessoa do time domina o stack base — frontend, backend,
              segurança e desenvolvimento agêntico — antes de se aprofundar em
              uma torre.
            </div>
          </div>

          {/* Towers */}
          <div className={styles.towersWrap}>
            <div className="subname" style={{ marginBottom: 14 }}>
              · torres de aprofundamento
            </div>
            <div className={styles.towersRow}>
              <div className="tower fe">
                <div className="head">
                  Frontend / UX·UI <span className="ix">T1</span>
                </div>
                <ul>
                  <li>Traduz problemas em fluxos, jornadas e interfaces claras</li>
                  <li>Garante produto compreensível sem necessidade de instruções</li>
                  <li>Define estrutura de interação (protótipos, navegação, arquitetura)</li>
                  <li>Trabalha hipóteses de comportamento (JTBD, heurísticas)</li>
                  <li>Atua na validação inicial (descoberta + testes rápidos)</li>
                  <li>Mantém aplicação otimizada do ponto de vista de performance percebida</li>
                  <li>Aplica reutilização de componentes e consistência visual</li>
                </ul>
              </div>

              <div className="tower be">
                <div className="head">
                  Backend / Dados <span className="ix">T2</span>
                </div>
                <ul>
                  <li>Domínio profundo em Supabase e tecnologias associadas</li>
                  <li>Estrutura e garante funcionalidade do sistema de Auth</li>
                  <li>APIs com limitações técnicas e trade-offs de arquitetura</li>
                  <li>Configura funções server-side (triggers, cron jobs, etc.)</li>
                  <li>Otimiza edge functions buscando eficiência e desempenho</li>
                  <li>Gerencia camada inicial de segurança server-side (RLS, secrets)</li>
                </ul>
              </div>

              <div className="tower qa">
                <div className="head">
                  QA <span className="ix">T3</span>
                </div>
                <ul>
                  <li>Define e executa estratégias de teste (funcional, regressão, integração, E2E)</li>
                  <li>Valida regras de negócio e fluxos críticos com aderência aos requisitos</li>
                  <li>Automatiza testes sempre que possível (E2E, APIs, componentes críticos)</li>
                  <li>Identifica, documenta e prioriza bugs com clareza de impacto</li>
                </ul>
              </div>

              <div className="tower in">
                <div className="head">
                  Infra <span className="ix">T4</span>
                </div>
                <ul>
                  <li>Estrutura e mantém ambientes (dev, staging, produção)</li>
                  <li>Define e implementa processos de deploy e CI/CD</li>
                  <li>Garante escalabilidade, disponibilidade e resiliência</li>
                  <li>Monitora performance, erros e comportamento (observabilidade)</li>
                  <li>Gestão de infra em cloud (custos, recursos, otimização)</li>
                  <li>Padrões de arquitetura: serverless, containers, etc.</li>
                  <li>Rollback, backup e recuperação de falhas</li>
                </ul>
              </div>

              <div className="tower se">
                <div className="head">
                  Security <span className="ix">T5</span>
                </div>
                <ul>
                  <li>Mapeamento de superfície de ataque (APIs, endpoints, auth, edge functions)</li>
                  <li>Testes de vulnerabilidades em autenticação e autorização (RLS, escalation)</li>
                  <li>Exploração de falhas em APIs e backend (injeções, validação)</li>
                  <li>Testes em client-side: XSS, armazenamento, vazamento de tokens</li>
                  <li>Simulação de ataques reais (pentest manual + automatizado · OWASP Top 10)</li>
                  <li>Reporte e priorização de riscos (impacto vs esforço)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SlideFooter left="VOLUND · OPERAÇÃO" num="03 / 10" />
    </>
  );
}
