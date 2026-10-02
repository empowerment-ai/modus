# Competitive analysis: BPM, workflow, and orchestration platforms

Research date: 2026-10-01. Prepared for Throughline, an open-source process manager that modernizes the classic model-driven BPM tools of the 2000s.

**How to read this document.** Vendor capabilities come from vendor documentation, release notes, and press releases, and are attributed as vendor claims where they are claims. "Users praise / complain" lines summarize public review sites (G2, Gartner Peer Insights, PeerSpot, Capterra) and are indicative, not statistically representative. Prices are list prices or third-party estimates and change often. Where something could not be verified in public sources, the text says so.

## Contents

1. [Summary](#1-summary)
2. [Market snapshot](#2-market-snapshot)
3. [Product profiles](#3-product-profiles)
4. [Terminology map: classic BPM terms to modern terms](#4-terminology-map-classic-bpm-terms-to-modern-terms)
5. [Feature matrix](#5-feature-matrix)
6. [Best features to adopt](#6-best-features-to-adopt)
7. [Gaps and white space](#7-gaps-and-white-space)
8. [2025-2026 trends](#8-2025-2026-trends)
9. [Standards and references](#9-standards-and-references)

---

## 1. Summary

- Gartner created a new market category, Business Orchestration and Automation Technologies (BOAT), with its first Magic Quadrant in October 2025 (20 vendors) and a second edition in September 2026. Appian and Pega were Leaders in 2025; Appian and UiPath announced Leader placements in 2026.
- Every major vendor shipped "agentic" features in 2025-2026: AI agents as steps inside a governed process, plus Model Context Protocol (MCP) support in both directions (consume MCP tools, expose processes as MCP tools).
- Work allocation in the classic BPM sense (load-balanced, queue/fetch, supervisor, direct) is deep in Pega, ServiceNow, and IBM BAW, shallow in Camunda and Power Automate, and absent in Temporal and n8n.
- Simulation is the weakest link across the market. Bizagi simulates in its modeler before deployment; IBM and Celonis simulate inside process mining products that sit beside the engine; IBM deprecated the simulation feature inside its workflow engine. No product in our seven-product matrix runs what-if analysis directly on the live, deployed model with live data.
- In-flight instance migration is still painful: Power Automate has none, Temporal relies on code patching or worker versioning, Camunda and Appian have migration tools with limits.
- Open source is shrinking at the top of the market: Camunda 8 moved to a source-available license in 2024 and ended Camunda 7 Community Edition in October 2025; n8n uses a non-OSI "fair-code" license. Permissively licensed alternatives (Flowable OSS, Temporal, Operaton, Activepieces, Kestra) each cover only part of the feature set Throughline targets.
- Pricing is moving from per-user to consumption or outcome units (UiPath Platform Units, ServiceNow "assists", Temporal "actions", Pega per-case pricing for AI agents). Buyers complain about opacity across the board.
- The clearest white space for us: an open-source, model-driven engine where the same model is executed, mined, and simulated; with first-class resource patterns (work baskets and allocation strategies); that also handles high-volume event-driven processes.

## 2. Market snapshot

- **Analyst framing.** Gartner's 2025 BOAT Magic Quadrant ([abstract](https://www.gartner.com/en/documents/7072898)) covered 20 vendors including Appian, Automation Anywhere, Bizagi, Boomi, Camunda, Flowable, Hyland, IBM, Mendix, Microsoft, Newgen, Nintex, OutSystems, Pegasystems, Salesforce, SAP, ServiceNow, SS&C Blue Prism, UiPath, and Workato (vendor list as reported by [Newgen](https://newgensoft.com/resources/analyst-report-gartner-magic-quadrant-for-business-orchestration-and-automation-technologies) and others). [Appian](https://appian.com/about/explore/press-releases/2025/appian-is-named-a-leader-in-inaugural-gartner-magic-quadrant-for-business-orchestration-and-automation-technologies) and [Pega](https://www.pega.com/node/454571) announced Leader placements; [Camunda](https://camunda.com/press_release/camunda-named-a-visionary-in-2025-gartner-magic-quadrant-for-business-orchestration-and-automation-technologies/) announced a Visionary placement. The 2026 edition ([abstract](https://www.gartner.com/en/documents/8381781)) was followed by Leader announcements from [UiPath](https://finviz.com/news/393631/uipath-recognized-as-a-leader-in-the-gartner-magic-quadrant-for-business-orchestration-and-automation-technology) and [Appian](https://itbrief.com.au/story/appian-tops-gartner-boat-rankings-in-two-use-cases).
- **Forrester.** In the Digital Process Automation Wave (Q3 2025), Appian and Pega announced Leader placements ([Appian](https://itwire.com/guest-articles/guest-research/appian-named-a-leader-in-digital-process-automation-software-report-by-independent-research-firm.html)) and Camunda a Strong Performer placement ([Camunda](https://camunda.com/press_release/camunda-recognized-for-best-in-class-orchestration-in-digital-process-automation-software-2025-report/)).
- **Consolidation.** ProcessMaker merged with Decisions in November 2025 ([Decisions](https://decisions.com/blog/introducing-decisions-a-unified-vision-for-the-future-of-enterprise-orchestration)). UiPath acquired WorkFusion in February 2026 ([UiPath](https://www.uipath.com/newsroom/uipath-introduces-maestro-case-for-dynamic-business-processes)). Process mining arrived in most suites by acquisition: Appian bought Lana Labs ([2021](https://appian.com/about/explore/press-releases/2021/appian-acquires-leading-process-mining-company)), IBM bought myInvenio ([2021](https://www.itpro.com/business-strategy/acquisition/359228/ibm-to-acquire-process-mining-company-myinvenio)), Microsoft bought Minit ([2022](https://msdynamicsworld.com/node/32714)), and Pega bought Everflow ([2022](https://www.nasdaq.com/press-release/pega-acquires-everflow-to-add-intuitive-process-mining-to-the-industrys-most-complete)).
- **Developer-first capital.** Temporal raised $146M at a $1.72B valuation in March 2025 ([press release](https://www.silicon.co.uk/press-release/temporal-technologies-secures-146m-at-1-72b-valuation-to-fuel-durable-production-agentic-workloads-globally)) and a reported $300M Series D at $5B in February 2026 ([report](https://startupintros.com/news/2026-02-17-temporal-technologies-series-d)). n8n raised $180M at $2.5B in October 2025 ([report](https://pulse2.com/n8n-180-million-series-c-at-2-5-billion-valuation-raised-for-expanding-ai-orchestration-platform)).

## 3. Product profiles

### 3.1 Appian
- **Positioning:** Appian markets an "AI Process Platform" for regulated enterprises and government. Leader in Gartner BOAT 2025 and 2026 (per Appian).
- **Standouts:** Data fabric (record types that virtualize data across sources); Process HQ, which runs process mining and AI analysis on Appian's own audit data ([silicon.eu](https://silicon.eu/appian-integrates-process-mining-and-enterprise-ai-into-its-platform-with-its-data-fabric-13438.html)); Agent Studio for AI agents inside processes, GA in late 2025 ([Appian 25.4](https://appian.com/blog/2025/appian-25-4-release-enterprise-ai-agents)); Case Management Studio, which Appian says lets business users configure case workflows in a no-code control panel (Advanced and Premium tiers, [docs](https://docs.appian.com/suite/help/25.4/case-management-studio-overview.html)); MCP connected systems and an Appian MCP server in the 26.x docs ([MCP connected system](https://docs.appian.com/suite/help/26.6/mcp-connected-system.html), [MCP server](https://docs.appian.com/suite/help/26.6/appian-mcp-server.html)); Process Upgrade to move running instances to a new model version ([docs](https://docs.appian.com/suite/help/latest/Process_Upgrade.html)).
- **Users praise:** speed of building workflow apps, integration, and AI features ([G2](https://www.g2.com/products/appian/reviews), [Gartner Peer Insights](https://www.gartner.com/reviews/product/appian-platform)).
- **Users complain:** steep learning curve for complex work, high license cost, limited UI customization (same sources).
- **Licensing:** per-user subscription in Standard, Advanced, and Premium tiers; no public list prices. Third-party estimates put entry pricing around $75 per user per month ([Superblocks](https://www.superblocks.com/blog/appian-pricing)).

### 3.2 Pega Platform (Pega Infinity, Blueprint, agentic)
- **Positioning:** case management plus real-time decisioning for large enterprises. Pega says it received the highest Critical Capabilities scores for Case Management and Enterprise Task and Process Automation in the 2025 BOAT report ([Pega](https://www.pega.com/node/454571)).
- **Standouts:** case lifecycle (stages and steps), SLA rules, and rich routing: push and pull routing, skill-based routing with proficiency levels, and AI-driven routing through Pega Process AI ([Pega Academy](https://academy.pega.com/node/100071)). Split-Join shapes support All, Any, or Some (count or condition) join conditions, which covers N-of-M partial joins ([Pega Academy](https://academy.pega.com/fr/topic/configuring-parallel-processing/v1/in/5256)). Pega Blueprint generates application designs from natural language ([PegaWorld 2025](https://www.businesswire.com/news/home/20250602253846/en/New-Pega-Infinity-Agentic-AI-Features-Elevate-Enterprise-App-Development-from-Concept-to-Completion)). Infinity '26 (GA July 2026) exposes Pega processes as MCP servers and introduces "Predictable AI", which concentrates LLM reasoning at design time ([Business Wire](https://www.businesswire.com/news/home/20260714981812/en/), [CustomerThink](https://customerthink.com/pegas-fix-for-runaway-ai-costs-stop-the-agents-from-thinking-at-runtime/)).
- **Users praise:** depth for complex, regulated case work and decisioning ([G2](https://www.g2.com/products/pega-platform/reviews)).
- **Users complain:** complexity despite "low-code" branding, reliance on Pega-certified developers, total cost of ownership, and parts of the UI that feel dated (same source).
- **Licensing:** enterprise subscription (Pega Cloud or client-managed). For AI agents, Pega announced a flat charge per completed case instead of per-token pricing; [CX Today](https://www.cxtoday.com/?p=992594) advises buyers to read the fine print.

### 3.3 Camunda 8 (Zeebe, Connectors, Operate, Tasklist, Optimize)
- **Positioning:** standards-based (BPMN 2.0, DMN) process orchestration for developers, now marketed as "agentic orchestration". BOAT Visionary 2025.
- **Standouts:** Zeebe, a partitioned, event-sourced engine that scales horizontally (Camunda's own benchmark showed throughput growing roughly linearly with brokers and partitions, [blog](https://camunda.com/blog/2019/08/zeebe-horizontal-scalability/)); job workers for automated steps; inbound connectors that start or correlate processes from Kafka, webhooks, and queues ([docs](https://docs.camunda.io/docs/8.8/components/connectors/use-connectors/inbound/)); process instance migration in Operate ([docs](https://docs.camunda.io/docs/8.8/components/operate/userguide/process-instance-migration/)); RPA and IDP since 8.7 ([blog](https://camunda.com/blog/2025/04/camunda-8-7-release/)); AI Agent connector plus ad-hoc subprocess and an MCP Client connector in 8.8 ([docs](https://docs.camunda.io/docs/components/agentic-orchestration/ai-agents/)); a built-in MCP server in 8.9, released April 2026 ([blog](https://camunda.com/blog/2026/04/camunda-8-9-fastest-path-to-agentic-orchestration/)). Camunda's own write-up of three MCP patterns is a good design reference ([blog](https://camunda.com/blog/2026/08/three-ways-camunda-speaks-mcp-and-why-the-direction-matters/)).
- **Users praise:** clear BPMN models that business and IT can discuss, flexibility, developer friendliness ([G2](https://www.g2.com/products/camunda/reviews), [Gartner Peer Insights](https://www.gartner.com/reviews/market/business-process-automation-tools/vendor/camunda/product/camunda)).
- **Users complain:** remains developer-centric, so business users depend on developers; steep learning curve for BPMN error and event handling (same sources).
- **Licensing:** since 8.6 (October 2024) all Self-Managed components use the source-available Camunda License 1.0: free for development and testing, production requires an Enterprise license ([Camunda](https://camunda.com/blog/2024/04/licensing-update-camunda-8-self-managed/), [pricing](https://camunda.com/pricing/)). Camunda 7 Community Edition reached end of life in October 2025, which produced open-source forks such as [Operaton](https://www.itemis.com/en/blog/custom-software/full-stack/operaton-openbpm-camunda-7-end-of-life/) (Apache 2.0) and [CIB seven](https://cib.de/en/seven).

### 3.4 IBM Business Automation Workflow / Cloud Pak for Business Automation
- **Positioning:** an enterprise suite (workflow and case, ODM decisions, FileNet content, document processing, RPA, process mining) running on Red Hat OpenShift.
- **Standouts:** the 2025 release triggers watsonx Orchestrate agents natively from BAW workflows and adds MCP-compliant local servers ([IBM Community](https://community.ibm.com/community/user/blogs/aliannah-muzaffar/2026/04/02/product-update-ibm-business-automation)). BAW documents "Load Balance" (assign to the user with the fewest open tasks) and "Round Robin" routing, the closest match to classic load-balanced distribution ([IBM docs](https://www.ibm.com/docs/en/baw/SS8JB4_26.0.x/com.ibm.wbpm.wle.editor.doc/topics/routing_activities.html)). IBM Process Mining includes what-if simulation ([IBM docs](https://www.ibm.com/docs/en/SSWR2IP_1.12.0/process-mining-documentation/landingpage.html)), while the older simulation and optimizer inside the workflow engine is marked deprecated ([IBM docs](https://www.ibm.com/docs/en/SSFPJS_8.6.0/com.ibm.wbpm.wle.admin.doc/topics/optimizer_introduction.html)).
- **Users praise:** stability, scalability, case management and integration ([PeerSpot](https://www.peerspot.com/products/ibm-business-automation-workflow/archived_reviews)).
- **Users complain:** high and rising license cost, heavyweight installation, UI shortcomings ([PeerSpot](https://www.peerspot.com/products/ibm-bpm-pros-and-cons)).
- **Licensing:** IBM Cloud Pak licensing; quote-based.

### 3.5 ServiceNow (Workflow Studio, App Engine, Workflow Data Fabric)
- **Positioning:** enterprise workflow platform that grew out of IT service management; now positions itself as an AI agent control plane.
- **Standouts:** Workflow Data Fabric and Zero Copy connectors, introduced October 2024 ([press release PDF](https://s205.q4cdn.com/537566246/files/doc_news/ServiceNow-introduces-Workflow-Data-Fabric-forging-a-new-generation-of-AI-fueled-productivity-for-the-enterprise-10-23-2024-traffic-2024.pdf)); Zurich release with AI Agent Orchestrator, AI Agent Fabric (MCP and Agent2Agent), MCP Server Console and MCP Client ([Zurich highlights](https://www.servicenow.com/docs/r/zurich/release-notes/release-highlights.html), [MCP Server Console](https://www.servicenow.com/docs/r/zurich/intelligent-experiences/exploring-mcp-server-console.html)); Advanced Work Assignment with "most capacity" and "last assigned" rules plus skills ([docs](https://www.servicenow.com/docs/bundle/yokohama-servicenow-platform/page/administer/advanced-work-assignment/concept/awa-assignment.html)); Process Mining with bottleneck and ML root-cause analysis ([product page](https://www.servicenow.com/uk/products/process-optimization.html)); Stream Connect for Apache Kafka with a Kafka message flow trigger ([product page](https://www.servicenow.com/products/stream-connect-for-apache-kafka.html)). The 2026 Australia release adds AI Agent Advisor, which ServiceNow says finds lagging workflows and suggests fixes ([release notes](https://www.servicenow.com/docs/r/release-notes/rn-summary-new-features.html)).
- **Users praise:** governance, scale, fast delivery of low-code workflows ([TechRadar](https://www.techradar.com/pro/software-services/servicenow-review)).
- **Users complain:** opaque and expensive licensing; deep customization needs experienced admins (same).
- **Licensing:** per-user subscription by tier plus AI consumption ("assists"). Licensing advisors and ServiceNow community posts report that in April 2026 the legacy tiers were replaced by Foundation, Advanced, and Prime ([ServiceNow Community](https://www.servicenow.com/community/architect-articles/the-april-2026-servicenow-csm-packaging-redesign-what/ta-p/3562359), [Redress Compliance](https://redresscompliance.com/servicenow-2026-pricing-tiers-pillar)).

### 3.6 Microsoft Power Automate (incl. Process Mining, desktop flows)
- **Positioning:** automation for the Microsoft 365 and Power Platform estate; agentic work increasingly lives in Copilot Studio "agent flows".
- **Standouts:** cloud flows with a large connector catalog; desktop flows (RPA); AI Builder document processing; Process Mining based on the Minit acquisition, with root-cause analysis ([Learn](https://learn.microsoft.com/en-ie/power-automate/minit/minit-desktop-application-overview)); 2025 release waves focus on generative actions, human-in-the-loop, and a process map across cloud and desktop automations ([2025 wave 2](https://learn.microsoft.com/en-us/power-platform/release-plan/2025wave2/power-automate/)). MCP is GA in Copilot Studio ([Microsoft](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/model-context-protocol-mcp-is-now-generally-available-in-microsoft-copilot-studio)).
- **Users praise:** reach inside Microsoft 365, breadth of connectors, low entry price ([G2](https://www.g2.com/products/microsoft-power-automate/reviews)).
- **Users complain:** licensing complexity and premium-connector costs, vague error messages that make complex flows hard to debug (same).
- **Licensing:** Premium $15 per user per month; Process $150 per bot per month; Hosted Process $215 per month ([Microsoft pricing](https://powerautomate.microsoft.com/pricing)).
- **Versioning note:** runs continue on the definition they started with; changes apply only to new runs ([Forward Forever](https://forwardforever.com/can-i-edit-a-cloud-flow-while-its-running/), [drafts and versioning](https://learn.microsoft.com/en-us/power-automate/drafts-versioning)).

### 3.7 Nintex (Workflow, Process Manager / Promapp)
- **Positioning:** mid-market and SharePoint-heritage automation. In September 2025 Nintex announced "Agentic Business Orchestration" with Agent Designer and Nintex Orchestration in Nintex CE ([Business Wire](https://www.businesswire.com/news/home/20250924880684/en)).
- **Standouts:** Process Manager (formerly Promapp, [acquisition](https://itbrief.com.au/story/nintex-acquires-auckland-based-bpm-leader-promapp)) lets business teams document and own their processes in simple maps that frontline staff read. This is a good model for "business people can change the process".
- **Users praise:** forms and simple workflows built without code.
- **Users complain:** opaque, quote-driven pricing that rises with scale; learning curve for advanced features; performance on complex or high-volume workflows ([Capterra](https://www.capterra.com/p/141379/Nintex/reviews/), [FlowForma comparison](https://www.flowforma.com/blog/kissflow-vs-nintex)).
- **Licensing:** a 2025 UK G-Cloud pricing document lists consumption tiers with included workflow instances (for example, a Pro tier with 10,000 instances per year) and user-count-based enterprise tiers ([G-Cloud PDF](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-14/documents/707658/418594743301315-pricing-document-2025-07-28-0924.pdf)).

### 3.8 Bizagi
- **Positioning:** low-code BPM with a widely used free BPMN modeler; included in the 2025 BOAT Magic Quadrant.
- **Standouts:** Modeler simulation in four levels: process validation, time analysis, resource analysis, and calendar analysis ([docs](https://help.bizagi.com/platform/en/simulation_levels.htm)). Spring 2025 added "AI Workers" that prefill forms and explain recommendations ([Bizagi](https://www.bizagi.com/resources/newsroom/bizagi-launches-new-ai-workers-in-spring-2025-platform-release)); Fall 2025 added MCP support for AI agents and reinforcement learning ([Bizagi](https://www.bizagi.com/resources/newsroom/bizagi-s-fall-2025-release-provides-powerful-new-ai-capabilities)).
- **Users praise:** ease of use and intuitive BPMN modeling ([G2](https://www.g2.com/products/bizagi-platform/reviews)).
- **Users complain:** some report modeler usability regressions such as connections lost when moving shapes (same). Bizagi says the standalone Modeler has no immediate upgrade plans beyond maintenance ([FAQ](https://help.bizagi.com/platform/en/bm-faqs.htm)).
- **Licensing:** free Modeler; platform by quote.

### 3.9 ProcessMaker (now part of Decisions)
- **Positioning:** mid-market low-code BPM and IDP. Merged with Decisions (rules engine and orchestration) in November 2025 ([Decisions](https://decisions.com/blog/introducing-decisions-a-unified-vision-for-the-future-of-enterprise-orchestration)); a third-party review reports the ProcessMaker brand was retired in June 2026 ([Tallyfy](https://tallyfy.com/processmaker-review/)).
- **Standouts:** Spring 2025 added "Genies" (LLM task agents), RAG collections, more decision-table hit policies, and a process-intelligence browser extension ([ProcessMaker](https://www.processmaker.com/resources/customer-success/news/processmaker-unveils-spring-2025-release-of-automation-platform)). The core has a history as AGPLv3 open source ([GitHub](https://github.com/ProcessMaker/processmaker)).
- **Users praise:** easy to configure without coding, flexibility ([Capterra](https://capterra.com/p/118311/ProcessMaker-BPM-Software/reviews/)).
- **Users complain:** reporting is hard, workflows need re-checking after upgrades, complex triggers (same).
- **Licensing:** enterprise subscription; community edition historically AGPLv3.

### 3.10 Kissflow
- **Positioning:** no-code/low-code workflow for business teams and middle-office processes.
- **Standouts:** "document-to-workflow" AI that turns documents and spreadsheets into workflows (shipped Q4 2025) and a 2026 roadmap with AI agents for reporting and approval recommendations ([Kissflow community](https://community.kissflow.com/t/q6ypgaa/kissflow-roadmap-2026)).
- **Users praise:** intuitive designer that non-technical teams can use ([Software Advice](https://www.softwareadvice.com/workflow/kissflow-profile/)).
- **Users complain:** price climbs as users are added (same).
- **Licensing:** from about $1,500 per month for 50 users on the Basic plan; Enterprise by quote (same).

### 3.11 Flowable
- **Positioning:** BPMN, CMMN, and DMN engines with an Apache 2.0 open-source core ([Flowable OSS](https://flowable.com/open-source-download)) and commercial Flowable Work and Design. Included in the 2025 BOAT Magic Quadrant.
- **Standouts:** the only widely used engine still investing in CMMN; Flowable 2025.1 (July 2025) added a dedicated agent engine alongside BPMN and CMMN ([Flowable](https://www.flowable.com/blog/releases/flowable-2025-1-intelligent-orchestration), [press release](https://www.newsfilecorp.com/release/259603)). The open-source engine line reached 8.0.0 in early 2026 ([Maven Central](https://mvnrepository.com/artifact/org.flowable/flowable-app-engine-api/8.0.0)).
- **Users praise:** workflow and form design tools, REST integration ([G2](https://g2.com/products/flowable-platform/reviews)).
- **Users complain:** learning curve for intricate setups, thin documentation for advanced features (same; small review sample).
- **Licensing:** Apache 2.0 engines; commercial subscription for the Work/Design/AI products.

### 3.12 OutSystems and Mendix (workflow inside low-code app platforms)
- **OutSystems:** ODC Workflows lets developers and business users build event-driven workflows with human tasks, decisions, waits, and parallel flows ([OutSystems](https://www.outsystems.com/product-updates/odc-parallel-flows)). Agent Workbench (early access July 2025) adds multi-agent orchestration ([OutSystems](https://www.outsystems.com/news/outsystems-agent-workbench-ai)).
- **Mendix (Siemens):** Mendix 11 (June 2025) added "Maia for Workflows" (generate workflows from text or images), BPMN visualization in the workflow editor, a Global Inbox across apps, and an Agents Kit ([Mendix](https://www.mendix.com/blog/mendix-release-11-0-start-with-ai-build-anything-the-next-era-of-enterprise-development-is-here/)).
- **Note:** both are application platforms first; workflow is one module. User sentiment was not researched separately for this document.
- **Licensing:** quote-based subscriptions tied to apps, users, and cloud capacity.

### 3.13 UiPath (Maestro agentic orchestration)
- **Positioning:** RPA leader repositioned around "agentic automation". UiPath announced a Leader placement in the 2026 BOAT Magic Quadrant.
- **Standouts:** Maestro, GA April 30, 2025, is a BPMN-based orchestration layer with a new execution engine for agents, robots, and people ([release notes](https://docs.uipath.com/maestro/automation-cloud/latest/release-notes/april-2025)); it uses DMN for decisions and adds case management and Process Apps (FUSION 2025, [UiPath](https://www.uipath.com/blog/product-and-updates/orchestrating-the-agentic-enterprise-whats-new-in-uipath-2025-10)). Autopilot for Maestro (natural language to BPMN) went GA in December 2025 ([release notes](https://docs.uipath.com/maestro/automation-cloud/latest/release-notes/december-2025)). Maestro Case (June 2026) targets exception-heavy cases such as KYC and claims ([UiPath](https://www.uipath.com/newsroom/uipath-introduces-maestro-case-for-dynamic-business-processes)). Maestro Flow opens the canvas to coding agents such as Claude Code and Cursor ([iTWire](https://itwire.com/business-it-news/business-software/uipath-hands-the-orchestration-canvas-to-claude-code-cursor-and-copilot-with-maestro-flow)).
- **Users praise:** ease of building automations, intuitive tooling ([Capterra](https://www.capterra.com/p/135186/UiPath-Robotic-Process-Automation/reviews/)).
- **Users complain:** high and complex licensing, Orchestrator administration overhead, frequent version changes ([PeerSpot](https://www.peerspot.com/products/uipath-pros-and-cons)).
- **Licensing:** "Unified Pricing" with a single consumption currency (Platform Units), alongside the older Flex plan; Maestro is consumed via Platform Units ([UiPath docs](https://docs.uipath.com/maestro/automation-cloud/latest/release-notes/may-2025)).

### 3.14 Celonis (process mining / process intelligence)
- **Positioning:** the process mining market leader (Gartner Process Mining MQ Leader for the third year in 2025, [Celonis](https://www.celonis.com/news/press/celonis-recognized-as-a-leader-for-third-consecutive-year-in-2025-gartner-magic-quadrant-for-process-mining-platforms)), now moving into execution.
- **Standouts:** Process Intelligence Graph (Celonis calls it a digital twin of operations); at Celosphere 2025 the Orchestration Engine became GA and Celonis launched a process-intelligence MCP server ([Business Wire](https://www.businesswire.com/news/home/20251104046489/en/Celonis-Unveils-Platform-Innovations-to-Power-the-AI-Driven-Composable-Enterprise)); Process Simulation and natural-language Scenario Simulation predict KPI impact before a change ([Celonis](https://www.celonis.com/news/article/from-insight-to-impact-operationalizing-ai-with-process-intelligence-at-celonis-garage)). Celonis sued SAP in March 2025 over data access; SAP agreed not to interfere with Celonis' extractor while the case proceeds ([Celonis](https://www.celonis.com/news/press/legal-update-sap-agrees-to-not-interfere-with-celonis-extractor-in-antitrust-litigation)), with trial scheduled for March 2027 per SAP's annual report ([SEC 20-F](https://www.sec.gov/Archives/edgar/data/1000184/000110465926020058/sap-20251231x20f.htm)).
- **Users praise:** end-to-end visibility and turning operational data into actionable insight ([G2](https://www.g2.com/products/celonis)).
- **Users complain:** complex, time-consuming setup and data integration; cost; changing license structure (same).
- **Licensing:** enterprise subscription, quote-based.

### 3.15 Temporal (durable execution, code-first)
- **Positioning:** workflows as ordinary code that survives crashes and restarts ("durable execution"), increasingly marketed as the execution layer for AI agents.
- **Standouts:** event-sourced execution history, durable timers, retries, child workflows, signals and updates; OpenAI Agents SDK integration (public preview, July 2025, [Temporal](https://temporal.io/blog/announcing-openai-agents-sdk-integration)); Worker Versioning with "pinned" and "auto-upgrade" behaviors, GA in 2026 ([docs](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)). Joined the Agentic AI Foundation as a Gold member ([Business Wire](https://www.businesswire.com/news/home/20251210314521/en/Temporal-Joins-the-Agentic-AI-Foundation-as-a-Gold-Member-to-Advance-Open-Standards-for-Production-Agent-Workloads)).
- **Users praise:** reliability and writing the "happy path" in a normal language while the platform handles failure.
- **Users complain:** determinism constraints, and changing code for long-running workflows through patches or worker versioning is hard ([Temporal docs](https://docs.temporal.io/workflow-definition), [community thread](https://community.temporal.io/t/versioning-difficulty/3016)).
- **Licensing:** MIT-licensed server and SDKs. Temporal Cloud starts at $50 per million actions with volume tiers ([docs](https://docs.temporal.io/cloud/pricing)).

### 3.16 n8n (incl. AI agent nodes)
- **Positioning:** node-based workflow automation with strong AI agent support; popular for self-hosting.
- **Standouts:** AI Agent nodes, MCP Server Trigger (expose workflows as MCP tools) and MCP Client Tool ([docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/)); human review of AI tool calls and "send and wait" approvals ([docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.chat/)); Kafka and MQTT triggers ([MQTT](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.mqtttrigger/)); n8n 2.0 (December 2025) separated "save" from "publish" and isolated code execution in task runners ([changelog](https://docs.n8n.io/changelog/v20-breaking-changes)). By default, v1+ executes branches one at a time, not concurrently ([docs](https://docs.n8n.io/flow-logic/execution-order)).
- **Users praise:** flexibility, self-hosting, cost ([G2](https://www.g2.com/products/n8n/reviews)).
- **Users complain:** debugging complex flows, cluttered canvas on large workflows, learning curve for non-developers (same).
- **Licensing:** Sustainable Use License ("fair-code", not OSI-approved): internal business use is allowed; hosting workflows for multiple customers requires a commercial license ([n8n docs](https://docs.n8n.io/reference/license/), [LICENSE.md](https://github.com/n8n-io/n8n/blob/master/LICENSE.md)).

### 3.17 Other notable entrants (2025-2026)
- **Microsoft Copilot Studio agent flows:** rebuilt in June 2026 with a new workflow designer and agent nodes; MCP tools in agent workflows GA July 2026 (per [Collab365](https://spaces.collab365.com/posts/microsoft-ships-rebuilt-copilot-studio-for-complex-u_jKJ_) and Microsoft message center notes).
- **Kestra 1.0** (September 2025): open-source, declarative YAML, event-driven orchestration with AI agents and human-in-the-loop approvals ([Kestra](https://kestra.io/blogs/release-1-0)).
- **Activepieces:** MIT-licensed automation where every integration "piece" is also exposed as an MCP server ([GitHub](https://github.com/activepieces/activepieces)).
- **Camunda 7 forks:** Operaton and CIB seven keep an embeddable, open-source BPMN engine alive after Camunda 7 CE end of life.
- **Bonita (Bonitasoft):** long-running open-source BPM with a free Community edition ([Bonitasoft](https://www.bonitasoft.com/news/bpm-for-masses-most-demanding-itwire-miguel-valdes-faur)).
- **Apache KIE (jBPM, Drools, SonataFlow):** open-source BPMN/DMN and CNCF Serverless Workflow runtime ([Apache KIE](https://kie.apache.org/docs/10.2.x/sonataflow/serverlessworkflow/1.43.0.Final/core/cncf-serverless-workflow-specification-support.html)).

### 3.18 Pricing models at a glance

| Product | Pricing unit | Public list price? | Notes |
|---|---|---|---|
| Appian | Per user per month, by tier (Standard, Advanced, Premium) | No | Third-party estimate about $75 per user per month entry; Community Edition free for learning |
| Pega | Enterprise subscription; per completed case for AI agents (2026) | No | Outcome-based pricing marketed as removing the "AI token tax" |
| Camunda 8 | Enterprise subscription (SaaS or Self-Managed) | No | Free for development and testing; production needs a license |
| IBM CP4BA | Cloud Pak licensing | No | Quote-based |
| ServiceNow | Per user by tier plus AI "assists" | No | Tiers reportedly repackaged in April 2026 |
| Power Automate | Per user ($15 Premium) or per bot/flow ($150 Process, $215 Hosted Process) | Yes | Premium connectors and AI credits drive cost |
| Nintex | Consumption tiers with included instances, or employee-count tiers | Partly (G-Cloud listing) | Overage per workflow instance |
| Bizagi | Subscription | No | Modeler free |
| Kissflow | Per plan by user band | Yes | From about $1,500 per month for 50 users |
| UiPath | Platform Units (Unified Pricing) or Flex buckets | Partly | Maestro consumes Platform Units |
| Celonis | Enterprise subscription | No | Reviewers report changing license structures |
| Temporal | Free self-hosted (MIT); Cloud per action | Yes | $50 per million actions at entry tier |
| n8n | Self-hosted free under SUL; cloud and enterprise plans | Yes (cloud) | Multi-customer hosting needs commercial license |

### 3.19 Open-source and source-available landscape

Licenses below were checked against each project's repository or license page.

| Project | License | Scope | Gap versus Throughline's needs |
|---|---|---|---|
| Camunda 8 | Camunda License 1.0 (source-available; production license required) | Full BPMN/DMN platform | Not open source for production; allocation needs custom code |
| [Operaton](https://github.com/operaton/operaton), [CIB seven](https://github.com/cibseven/cibseven) (Camunda 7 forks) | Apache 2.0 | Embeddable BPMN/DMN engine, cockpit, tasklist | Inherits Camunda 7 design; no mining or simulation |
| [Flowable OSS](https://github.com/flowable/flowable-engine) | Apache 2.0 | BPMN, CMMN, DMN engines and REST API | UI, modeling, and agent features are commercial |
| Apache KIE (jBPM, Drools) | Apache 2.0 | BPMN/DMN engines, rules | Developer-oriented; small business-user tooling |
| [Bonita](https://github.com/bonitasoft/bonita-engine) | LGPL 2.1 (engine) | BPM platform with Community edition | Clustering and monitoring in commercial edition |
| ProcessMaker (now Decisions) | AGPLv3 (community core, historical) | Low-code BPM | Future of community edition after the merger unclear |
| [Temporal](https://github.com/temporalio/temporal) | MIT | Durable execution engine and SDKs | No modeler, inbox, allocation, or data model |
| [Kestra](https://github.com/kestra-io/kestra) | Apache 2.0 | Declarative, event-driven orchestration | Data and infra focus; no human-task allocation |
| [Activepieces](https://github.com/activepieces/activepieces/blob/main/LICENSE) | MIT (community), separate license for `ee` folders | Integration automation, MCP tools | No BPMN semantics or work allocation |
| n8n | Sustainable Use License (fair-code, not OSI) | Integration and AI automation | Not open source; no inbox or allocation |

---

## 4. Terminology map: classic BPM terms to modern terms

### 4.1 Core term map

| Classic term | BPMN 2.0 / standard term | Workflow Patterns ID | Vendor terms | Notes for our product |
|---|---|---|---|---|
| Broadcast | Parallel gateway (fork, AND-split); inclusive gateway (OR-split) for conditional fan-out; parallel multi-instance activity | WCP-2 Parallel Split; WCP-6 Multi-Choice; WCP-12 to 15 Multiple Instances | Appian "AND gateway"; Pega "Split-Join", "Split-ForEach"; ServiceNow "Do the following in parallel"; Power Automate "parallel branch"; Enterprise Integration Patterns "Scatter-Gather" ([EIP](https://www.enterpriseintegrationpatterns.com/patterns/messaging/BroadcastAggregate.html)) | Decide per step: fork the same object (AND), fork conditionally (OR), or one branch per item in a list (multi-instance). |
| Rendezvous | Parallel gateway join (AND-join, synchronization); inclusive gateway join; complex gateway with `activationCondition` for N-of-M; multi-instance `completionCondition` | WCP-3 Synchronization; WCP-7 Structured Synchronizing Merge; WCP-9 Structured Discriminator; WCP-30 Structured Partial Join; WCP-29/32 cancelling variants; WCP-34 to 36 partial joins for multiple instances | Pega join "All / Any / Some"; Camunda parallel and inclusive joins; EIP "Aggregator" | Offer All, Any (first wins), N-of-M, and "cancel the rest" as explicit options rather than an expression hidden in the gateway. |
| Device | Service task, send task, script task, business rule task | WRP-11 Automatic Execution | Camunda job worker / connector / external task; Temporal activity + worker; Appian smart service; ServiceNow action, spoke, MID Server; UiPath robot / agent; "digital worker"; "AI agent" | A device is an external worker that pulls jobs, reports results, and raises incidents. AI agents and RPA bots are device types. |
| Subflow | Call activity (reusable subprocess); embedded subprocess; event subprocess; ad-hoc subprocess | (no single pattern; relates to WCP-22 Recursion when self-calling) | Power Automate child flow; ServiceNow subflow; Temporal child workflow; n8n sub-workflow; Pega subprocess / child case | Distinguish "reusable, versioned separately" from "embedded in this model". |
| Work basket | Task list, worklist, work queue, group inbox (WfMC "worklist") | WRP-24 System-Determined Work Queue Content; WRP-25 Resource-Determined Work Queue Content; WRP-40/41 visibility | Pega "work queue" (formerly "workbasket", [Pega Academy](https://academy.pega.com/topic/organization-records/v1/in/2866/5276)); Camunda Tasklist; ServiceNow assignment-group queue; Appian group task | Keep "work basket" as a friendly alias in the UI; map to the standard concept in APIs and docs. |
| Distribution group | Role, group, team, candidate group; lane/performer in BPMN | WRP-2 Role-Based; WRP-10 Organisational; WRP-8 Capability-Based | IBM BAW "team"; ServiceNow "assignment group"; Camunda "candidate groups"; Pega work group plus skills | Model groups, roles, skills, and attributes (location, shift) separately so rules can combine them. |
| Supervisor-distributed | Manual allocation by a dispatcher or supervisor | WRP-3 Deferred Distribution; WRP-14 Distribution by Allocation; WRP-30/31 Reallocation | Pega "transfer"; ServiceNow manual assignment; Appian reassign | Give supervisors a board of unallocated items with drag-to-assign and workload counts. |
| Load-balanced | Shortest-queue or least-loaded allocation; capacity-based | WRP-17 Shortest Queue (also WRP-16 Round Robin, WRP-15 Random) | IBM BAW "Load Balance" (fewest open tasks) and "Round Robin"; ServiceNow AWA "Most capacity" and "Last assigned" | Define "load" explicitly: open items, weighted effort, or capacity per channel. |
| Queue (fetch) | Pull model: claim, "get next" | WRP-13 Distribution by Offer to Multiple Resources; WRP-21 Resource-Initiated Allocation; WRP-23 Resource-Initiated Execution of an Offered Work Item; WRP-26 Selection Autonomy | Pega "Get Next Work"; Camunda "claim"; ServiceNow "assign to me" | Support both "pick any" and "get next by priority" (and allow admins to disable cherry-picking). |
| Direct | Direct allocation to a named user | WRP-1 Direct Distribution; WRP-14 Distribution by Allocation to a Single Resource | Assignee (Camunda), assign to user (Appian) | Usually an expression on object data (for example, "the account owner"). |
| Decision on object metadata | Exclusive gateway with condition expressions; business rule task calling a DMN decision table | WCP-4 Exclusive Choice; WCP-6 Multi-Choice | Camunda DMN; Pega decision tables; Appian decisions; ServiceNow decision tables | Let business users edit decision tables without touching the diagram. |
| Dynamic object types | Case type, record type, business object, data model | Workflow Data Patterns ([paper](http://www.workflowpatterns.com/documentation/documents/data_patterns%20BETA%20TR.pdf)) | Appian record types; Pega case and data types; ServiceNow tables; Microsoft Dataverse tables | Runtime-defined schemas with versioning; JSON Schema is a practical interchange format. |
| Cascading linked lists | Dependent picklists, cascading dropdowns, hierarchical reference data | n/a | Widely supported in low-code form builders | Store lists as reference data with parent keys so processes and forms share them. |
| Object (the routed item) | Process instance carrying a case/record; "token" in BPMN execution semantics; "work item" for a human step | n/a | Pega case; Appian record + process; ServiceNow record + flow context | Keep the object and its process instance(s) distinct; one object may be in several processes. |
| Escalation / timeout | Boundary timer event, escalation event; SLA (goal, deadline, passed deadline) | WRP-28 Escalation | Pega SLA rules; ServiceNow SLA definitions | SLAs should be first-class objects, not just timers on the diagram. |

### 4.2 Workflow Resource Patterns (allocation vocabulary)

The Workflow Resource Patterns were defined by Russell, ter Hofstede, Edmond, and van der Aalst ([BETA working paper WP 127, 2004](http://www.workflowpatterns.com/documentation/documents/Resource%20Patterns%20BETA%20TR.pdf); [CAiSE 2005](http://www.workflowpatterns.com/documentation/documents/ResourcePatternsCAiSE.pdf)) and are catalogued at [workflowpatterns.com](http://www.workflowpatterns.com/patterns/resource/). The site uses "Distribution" in some names where the 2005 paper used "Allocation" (for example, WRP-1 "Direct Distribution", also known as Direct Allocation). Use these names in our docs and APIs.

| Group | Patterns | Relevance to Throughline |
|---|---|---|
| Creation (design time) | WRP-1 Direct Distribution; WRP-2 Role-Based Distribution; WRP-3 Deferred Distribution; WRP-4 Authorization; WRP-5 Separation of Duties; WRP-6 Case Handling; WRP-7 Retain Familiar; WRP-8 Capability-Based Distribution; WRP-9 History-Based Distribution; WRP-10 Organisational Distribution; WRP-11 Automatic Execution | Direct, distribution groups, and devices map here. Retain Familiar ("same person as the previous step") and Separation of Duties ("not the same person") are commonly requested and rarely modeled cleanly. |
| Push (system initiates) | WRP-12 Distribution by Offer, Single Resource; WRP-13 Distribution by Offer, Multiple Resources; WRP-14 Distribution by Allocation, Single Resource; WRP-15 Random Allocation; WRP-16 Round Robin Allocation; WRP-17 Shortest Queue; WRP-18 Early Distribution; WRP-19 Distribution on Enablement; WRP-20 Late Distribution | "Offer to multiple" is a shared work basket; "allocate to single" is direct or load-balanced. Shortest Queue is classic load balancing. |
| Pull (resource initiates) | WRP-21 Resource-Initiated Allocation; WRP-22 Resource-Initiated Execution, Allocated Work Item; WRP-23 Resource-Initiated Execution, Offered Work Item; WRP-24 System-Determined Work Queue Content; WRP-25 Resource-Determined Work Queue Content; WRP-26 Selection Autonomy | Classic queue/fetch. WRP-24 vs WRP-25 is "system sorts my basket" vs "I sort/filter my basket". |
| Detour (interruptions) | WRP-27 Delegation; WRP-28 Escalation; WRP-29 Deallocation; WRP-30 Stateful Reallocation; WRP-31 Stateless Reallocation; WRP-32 Suspension-Resumption; WRP-33 Skip; WRP-34 Redo; WRP-35 Pre-Do | Supervisor actions and exception handling. Each should be an audited, permissioned action. |
| Auto-start | WRP-36 Commencement on Creation; WRP-37 Commencement on Allocation; WRP-38 Piled Execution; WRP-39 Chained Execution | "Open next item automatically" modes for high-volume clerical work. |
| Visibility | WRP-40 Configurable Unallocated Work Item Visibility; WRP-41 Configurable Allocated Work Item Visibility | Who can see items in a basket before and after they are taken. |
| Multiple resources | WRP-42 Simultaneous Execution; WRP-43 Additional Resources | Two people on one item (for example, four-eyes review in the same step). |

### 4.3 Control-flow patterns most relevant to broadcast and rendezvous

From the revised control-flow catalogue ([Russell et al., BPM-06-22, 2006](http://www.workflowpatterns.com/documentation/documents/BPM-06-22.pdf); [list](http://www.workflowpatterns.com/patterns/control/)):

| Pattern | Meaning | BPMN construct |
|---|---|---|
| WCP-2 Parallel Split / WCP-3 Synchronization | Fork all branches / wait for all | Parallel gateway fork / join |
| WCP-6 Multi-Choice / WCP-7 Structured Synchronizing Merge | Fork a data-dependent subset / wait for exactly the branches that were started | Inclusive gateway fork / join |
| WCP-9 Structured Discriminator; WCP-28 Blocking; WCP-29 Cancelling | Continue on the first branch to finish; ignore or cancel the rest | Complex gateway; or event-based patterns |
| WCP-30 to 32 Partial Join (structured, blocking, cancelling) | Continue when N of M branches finish | Complex gateway `activationCondition`; multi-instance `completionCondition` |
| WCP-12 to 15 Multiple Instances | One branch per item; count known at design time, at run time, or open-ended | Multi-instance activity (parallel or sequential) |
| WCP-16 Deferred Choice | Whichever event happens first decides the path | Event-based gateway |
| WCP-19/20/25 Cancel Task / Case / Region | Stop work in progress | Terminate end event, boundary events, event subprocess |

### 4.4 Classic distribution modes: who supports them natively

Y native, P partial or custom code, N none, n/v not verified in public documentation.

| Mode | Pega | ServiceNow | IBM BAW | Appian | Camunda 8 | Power Automate |
|---|---|---|---|---|---|---|
| Direct | Y | Y | Y | Y | Y: assignee | Y: named approver |
| Distribution group (offer to many) | Y: work queue | Y: assignment group | Y: team / lane | Y: group task | Y: candidate groups | P: "first to respond" approval |
| Queue / fetch (pull) | Y: Get Next Work | Y | Y: claim | Y: accept group task | Y: claim | N |
| Load-balanced (shortest queue) | n/v | Y: AWA "most capacity" | Y: Load Balance | n/v | P: custom task listener | N |
| Round robin | n/v | P: AWA "last assigned" | Y: Round Robin | n/v | P: custom task listener | N |
| Skills / capability | Y: skill-based routing | Y: skills | n/v | n/v | P: custom task listener | N |
| Supervisor-distributed | Y: transfer | Y: manual assign | Y: reassign | Y: reassign | P: Tasklist/API | P: reassign approval |

---

## 5. Feature matrix

Legend: **Y** native; **P** partial, add-on, or workaround; **N** not supported natively; **n/v** not verified in public documentation. Cells reflect public documentation as of 2026-10-01 and are meant to orient, not to replace a proof of concept.

| Capability | Appian | Pega | Camunda 8 | ServiceNow | Power Automate | Temporal | n8n |
|---|---|---|---|---|---|---|---|
| Visual BPMN-style modeling | Y: BPMN-based process modeler | P: case lifecycle + Pega flow notation | Y: native BPMN 2.0 | P: Flow Designer / Workflow Studio, not BPMN | P: step-list designer, not BPMN | N: code-first | P: node canvas, not BPMN |
| Parallel split / join | Y: AND gateway | Y: Split-Join, Split-ForEach | Y: parallel gateway | Y: parallel flow logic | Y: parallel branches | Y: in code | P: branches + Merge node; runs branches one at a time by default |
| Inclusive (OR) gateway; N-of-M join | Y: OR gateway; N-of-M n/v | Y: join All / Any / Some | Y: inclusive gateway; N-of-M via multi-instance completion condition | P: conditional branches | P: conditions per branch | Y: in code | P: IF/Switch + Merge |
| Subprocess / reusable subflow | Y: subprocesses | Y: subprocesses, child cases | Y: call activity, embedded, event subprocess | Y: subflows | Y: child flows | Y: child workflows | Y: sub-workflows |
| Templates / marketplace | Y: AppMarket | Y: Pega Marketplace | Y: Camunda Marketplace | Y: ServiceNow Store, spokes | Y: template gallery | P: sample repos | Y: large template library |
| Decision tables (DMN) | P: decision tables, DMN interchange n/v | P: decision tables/trees, not DMN | Y: DMN native | P: decision tables, not DMN | N | N: code | N: IF/Switch/code |
| Human task inbox | Y: tasks, sites | Y: worklists, work queues | Y: Tasklist or custom UI via API | Y: workspaces, queues | P: Approvals center, Teams | N: build via signals/updates | P: forms, send-and-wait; no inbox |
| Work allocation strategies | P: users/groups/expressions | Y: push/pull, skills, Get Next Work, AI routing | P: assignee/candidates; custom via task listeners | Y: AWA capacity, last-assigned, skills | P: approval types only | N | N |
| Delegation, reassignment, escalation | Y | Y | P: reassign via Tasklist/API; escalation modeled with events | Y | P: reassign approvals; timeouts | P: in code | N |
| SLAs, timers, escalations | Y: timers, escalations | Y: SLA rules (goal, deadline, passed) | P: timer/escalation events; no SLA object | Y: SLA engine | P: delays, timeouts | P: durable timers; no SLA object | P: Wait node, schedules |
| Field / step-level security | Y: record and field security | Y: access roles, attribute-based | P: resource authorizations | Y: table and field ACLs | P: Dataverse column security | N: namespace level | N: project/credential level |
| Case management (CMMN-style) | Y: Case Management Studio (Advanced/Premium tiers) | Y: core strength | P: ad-hoc subprocess; no CMMN in C8 | P: playbooks, stage-based designer | N | N | N |
| Dynamic data model / record types | Y: record types, data fabric | Y: case and data types | N: process variables only | Y: tables | P: via Dataverse | N | P: JSON items; storage mostly external |
| Low-code forms | Y | Y | P: Camunda Forms (basic) | Y | P: via Power Apps / adaptive cards | N | P: form trigger/node |
| Connectors (REST/OpenAPI, MCP) | Y: connected systems; MCP client and server (26.x docs) | Y: REST/SOAP; processes as MCP servers (Infinity '26) | Y: REST and many connectors; MCP client and server | Y: IntegrationHub; MCP client and server (Zurich) | Y: large catalog, custom connectors; MCP via Copilot Studio | P: SDK code; MCP via samples | Y: many nodes; MCP client and server |
| External task workers | P: via APIs | P: via APIs, queue processors | Y: job workers (core model) | P: MID Server | P: gateway, desktop machines | Y: workers (core model) | P: queue-mode workers (internal) |
| RPA | Y: Appian RPA | Y: Pega Robotic Automation | Y: Camunda RPA (since 8.7) | Y: RPA Hub | Y: desktop flows | N | N |
| AI agents in process | Y: Agent Studio | Y: agents + Blueprint | Y: AI Agent connector + ad-hoc subprocess | Y: AI Agent Orchestrator | Y: agent flows (Copilot Studio) | Y: OpenAI Agents SDK integration | Y: AI Agent node |
| Document processing (IDP) | Y | P: GenAI document features | Y: IDP (since 8.7) | Y: Document Intelligence | Y: AI Builder | N | P: OCR/LLM nodes |
| Process mining | Y: Process HQ | Y: Pega Process Mining | P: Optimize analytics on Camunda data only | Y: Process Mining | Y: Process Mining (Minit) | N | N |
| Simulation / what-if | N: not found | N for process models | N: token-simulation plugin is a visual walkthrough only | N: not found | P: Minit-derived tooling, separate from flow definitions | N: time-skipping test server is for tests | N |
| Real-time monitoring / bottlenecks | Y | Y | Y: Operate + Optimize heatmaps | Y | P: run history, automation center | P: Web UI + metrics | P: execution list |
| In-flight instance versioning & migration | Y: Process Upgrade | P: runtime rule resolution; flow changes can strand assignments | Y: instance migration (with limits) | P: runs continue on started version | N: runs finish on old definition | P: patching, Worker Versioning | N: draft/publish only |
| Audit trail | Y | Y | Y: history, audit logs (8.9) | Y | P: time-limited run history | Y: full event history | P: execution logs; log streaming in Enterprise |
| Multi-tenant (one install, many tenants) | n/v | n/v | Y: tenants (Self-Managed) | P: domain separation | P: environments | Y: namespaces | P: projects; multi-customer hosting needs commercial license |
| Self-hosted / open source | P: self-managed option, proprietary | P: client-managed, proprietary | P: source-available; production license required | N: SaaS-first | N: cloud service | Y: MIT | P: fair-code, not OSI |
| Event/stream-triggered processes (IoT, Kafka) | P: web APIs, message events; Kafka n/v | n/v | Y: inbound Kafka/queue/webhook connectors | Y: Stream Connect for Kafka | P: event connectors | P: your consumers start/signal workflows | Y: Kafka, MQTT, webhook triggers |
| Mobile | Y: native app | Y: mobile app | N: web Tasklist; build your own | Y: Now Mobile | Y: mobile app | N | N |

---

## 6. Best features to adopt

Our differentiators drive the ranking: (a) business people can change processes safely, (b) administrators see the big picture, bottlenecks, and run what-if on the actual model, (c) the same engine handles high-volume, non-business data processes, (d) open source.

### P0: must have for the first credible release

| # | Feature | Why | Best reference today |
|---|---|---|---|
| 1 | One model for execution, mining, and simulation | If the simulated model is a copy, it drifts from production and nobody trusts the numbers; a single model is the core of differentiator (b). | Nobody fully; Camunda (executable BPMN) + Bizagi (simulation levels) together show the pieces |
| 2 | What-if simulation seeded from live history | Arrival rates, step durations, branch probabilities, and staffing calendars should come from the engine's own log, so admins test "add two clerks" or "skip step X" in minutes. | Celonis Scenario Simulation, IBM Process Mining; open-source building blocks: [Prosimos and Simod](https://simod.readthedocs.io) |
| 3 | Live bottleneck overlay on the model | Counts, wait times, and basket depths drawn on the diagram give admins the big picture without a separate BI tool. | Camunda Optimize heatmaps, ServiceNow Process Mining bottleneck analysis |
| 4 | Built-in event log with process mining and OCEL 2.0 export | Mining our own audit data avoids the extract-and-transform projects reviewers complain about, and OCEL export keeps the data portable. | Appian Process HQ (mining on own audit data); [OCEL 2.0](https://www.ocel-standard.org) |
| 5 | Draft, validate, simulate, publish workflow with visual diff | Business users can edit safely when every change shows its impact before it goes live and can be rolled back. | n8n 2.0 save vs publish; Nintex Process Manager for business-owned maps |
| 6 | In-flight instance migration with mapping and preview | Long-running instances are the norm in case work; migration must be a supported, previewable operation. | Camunda Operate migration, Appian Process Upgrade |
| 7 | Full resource-pattern allocation: direct, role, capability, shortest queue, round robin, offer-to-many, pull/get-next | This is the heritage of classic BPM and a gap in most modern engines. | Pega routing, ServiceNow AWA, IBM BAW load balance/round robin |
| 8 | Detour actions: delegate, escalate, deallocate, reallocate, suspend, skip, redo | Supervisors need these daily; each must be permissioned and audited. | Pega, ServiceNow |
| 9 | SLAs as first-class objects (goal, deadline, breach actions) | Timers alone do not give reportable service levels or escalation chains. | Pega SLA rules, ServiceNow SLA definitions |
| 10 | Device protocol: external job workers with retries, backoff, timeouts, incidents | Makes "devices" language-agnostic and lets the same engine call AI models, RPA bots, or camera-analysis services. | Camunda job workers, Temporal activities |
| 11 | Event-stream start and correlation with idempotency keys | Required for camera, IoT, and Kafka-driven processes (differentiator c). | Camunda inbound connectors (message ID), ServiceNow Stream Connect, n8n MQTT/Kafka triggers |
| 12 | Permissive open-source license (Apache 2.0 or MIT) for the whole core, including inbox and analytics | The top of the market has moved to source-available or fair-code; a fully open core is a real differentiator (d). | Temporal (MIT), Flowable OSS and Operaton (Apache 2.0) |

### P1: next, to compete on depth

| # | Feature | Why | Best reference today |
|---|---|---|---|
| 13 | DMN decision tables bound to object metadata | Business users change rules without touching the diagram; a standard format avoids lock-in. | Camunda, Flowable |
| 14 | Dynamic object types with dependent lists | Modern form of classic dynamic object types and cascading lists. | Appian record types, ServiceNow tables |
| 15 | Case handling: stages, milestones, ad-hoc tasks | Many classic BPM processes are really cases with exceptions. | Pega case lifecycle; Flowable CMMN; Camunda ad-hoc subprocess |
| 16 | AI agent step with a bounded tool set and human approval of tool calls | Keeps agents auditable inside a deterministic process. | Camunda ad-hoc subprocess pattern; n8n tool-call approval |
| 17 | MCP in both directions | Processes as tools for outside agents, and MCP servers as tools inside processes, are now table stakes. | Camunda (client and server), Pega Infinity '26, ServiceNow Zurich |
| 18 | Natural-language to draft model, always editable as a diagram | Speeds first drafts for business users; the diagram stays the source of truth. | Pega Blueprint, UiPath Autopilot for Maestro, Mendix Maia |
| 19 | Separation of duties and retain-familiar rules | Common compliance and continuity requirements (WRP-5, WRP-7). | Defined by the resource patterns; not verified as declarative options in the products reviewed |
| 20 | Supervisor dispatch board | Drag-to-assign with live workload per person is the modern face of supervisor distribution. | ServiceNow agent workspaces with AWA; IBM BAW team dashboards (n/v in detail) |
| 21 | Connector SDK with OpenAPI import | Lowers the cost of new devices and integrations. | Power Automate custom connectors, Camunda element templates |
| 22 | Immutable, exportable audit trail per instance | Needed for regulated work and to feed mining and simulation. | Temporal event history |
| 23 | Template gallery and model import (BPMN XML) | Faster adoption and migration from other tools. | n8n templates, Camunda Marketplace |

### P2: later, or via partners

| # | Feature | Why | Best reference today |
|---|---|---|---|
| 24 | Mobile inbox (PWA first) | Field and on-call users, for example officers receiving dispatches. | Appian, ServiceNow mobile |
| 25 | IDP step template | Many classic BPM deployments were document-centric. | Camunda IDP, Power Automate AI Builder |
| 26 | RPA hooks as device types | Integrate existing bots rather than build RPA. | Power Automate desktop flows, UiPath |
| 27 | Multi-tenancy | Needed for hosting providers and shared-service centers. | Camunda tenants, Temporal namespaces |
| 28 | Agent-to-agent (A2A) interop | Emerging standard for cross-vendor agents. | ServiceNow AI Agent Fabric |
| 29 | Predicted SLA breach and AI-assisted routing | Uses the event log we already keep. | Pega Process AI routing |

---

## 7. Gaps and white space

1. **Cost and licensing opacity.** Appian, ServiceNow, Nintex, UiPath, and Celonis do not publish production list prices; reviewers repeatedly cite cost and licensing complexity (sections 3.1, 3.5, 3.7, 3.13, 3.14). ServiceNow reportedly repackaged all tiers in 2026, and UiPath and ServiceNow moved to consumption units. A free, permissively licensed core with predictable self-hosting cost is a clear position.
2. **Simulation is separated from execution.** IBM deprecated simulation inside its workflow engine and offers it in Process Mining. Celonis simulates on its process graph, outside the system that runs the work. Bizagi simulates in the modeler before deployment. None of the seven matrix products offers what-if analysis on the deployed model seeded with its own live data. A simulation-first engine can own this.
3. **Process mining is bolted on.** Appian (Lana Labs), IBM (myInvenio), Microsoft (Minit), and Pega (Everflow) all acquired their mining. Reviewers of standalone mining (Celonis) cite setup and data-integration effort. An engine that writes a clean, object-centric event log by design removes the extraction step.
4. **In-flight change is painful.** Power Automate runs finish on the old definition. Temporal users report that patching long-running workflow code is hard, and Temporal shipped a new Worker Versioning system (GA 2026) to address it. Appian upgrades one source version at a time. Camunda migration has documented limits. Safe, previewable migration is still a differentiator.
5. **"Low-code" that business users still cannot change.** Camunda reviewers say business users rely on developers; Pega reviewers mention certified developers; Appian reviewers cite a steep learning curve. Tools that business users do edit (Nintex Process Manager, Kissflow) are mostly documentation or simple approvals. A guarded "draft, simulate, publish" loop on the real model is unclaimed.
6. **Work allocation is thin outside the big suites.** Only Pega, ServiceNow, and IBM BAW offer rich allocation out of the box, all at enterprise prices. Camunda needs custom task listeners; Power Automate offers approval types; Temporal and n8n offer nothing. Implementing the 43 resource patterns well in open source is open ground.
7. **High-volume event processes with human dispatch.** A camera event feeding an AI comparison and then dispatching the nearest available officer needs stream intake, automated devices, decisions, capability- and location-based allocation, SLAs, and mobile tasks in one runtime. Per-user-priced BPM suites are built for clerical work; n8n, Kestra, and Temporal lack inboxes and allocation. Camunda comes closest (Zeebe scale, Kafka connectors) but needs custom assignment code and a production license.
8. **Licensing churn erodes trust.** Camunda moved to a source-available license (2024) and ended Camunda 7 CE (2025), prompting forks; n8n's license is not OSI-approved. Buyers who were burned are looking for governance they can rely on.
9. **Agent governance and cost.** Gartner expects over 40% of agentic AI projects to be canceled by end of 2027 ([Gartner](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027)). A deterministic process with bounded agent steps, plus simulation of agent latency, cost, and failure rates before go-live, addresses that risk directly.
10. **Code-first tools lack the business layer; model-first tools lack developer ergonomics.** Temporal has no diagram, inbox, or data model; BPM suites are awkward for developers. A model that round-trips with code (and that coding agents can edit, as UiPath Maestro Flow now allows) bridges the two.

### 7.1 Scenario check: camera signal to officer dispatch

A worked example of differentiator (c), used to test each product against one non-business, high-volume process.

1. A camera publishes a motion event to MQTT or Kafka (thousands per hour).
2. The process starts, deduplicating on camera ID and time window.
3. A device step calls a vision model to compare the frame with a watch list or baseline.
4. A decision table routes on confidence: discard, queue for human review, or dispatch.
5. Dispatch allocates the nearest available officer with the right capability, falling back to shortest queue.
6. An SLA timer escalates to a supervisor if nobody accepts within N seconds.
7. The officer accepts on a phone, resolves, and the outcome feeds back into monitoring and simulation ("what if we add a patrol unit on nights?").

| Step | Needed capability | Closest incumbents | Typical gap |
|---|---|---|---|
| 1-2 | Stream intake, idempotent start | Camunda inbound Kafka connector (message ID), ServiceNow Stream Connect, n8n MQTT trigger | Per-user BPM suites are not priced or tuned for machine-volume starts |
| 3 | Automated device calling an AI model | Camunda job workers, Temporal activities, n8n AI nodes | None significant |
| 4 | Business-editable decision table | Camunda DMN, Pega decision tables | Missing in Temporal, n8n, Power Automate |
| 5 | Capability- and location-aware allocation with fallback | ServiceNow AWA, Pega skill-based routing, IBM BAW load balance | Missing or custom code in Camunda, Temporal, n8n |
| 6 | SLA object with escalation chain | Pega, ServiceNow | Timers only elsewhere |
| 7 | Mobile accept, live bottleneck view, what-if on the deployed model | Mobile: Appian, ServiceNow; monitoring: Camunda Optimize | What-if on the live model: no product found |

No single product in this review covers all seven steps without custom code or a second product. That combination, in one open-source runtime, is the opening.

### 7.2 Resulting position

An open-source process manager whose single model is executed, monitored, mined, and simulated; that treats work allocation (the 43 resource patterns) as a first-class feature, not custom code; that lets business users change processes through a draft, simulate, publish loop; and that scales from clerical case work to machine-volume event processes.

## 8. 2025-2026 trends

1. **Agentic orchestration becomes the headline.** Vendors now position the process as the governance layer for AI agents: Camunda's ad-hoc subprocess with an AI Agent connector, UiPath Maestro, Appian Agent Studio, ServiceNow AI Agent Orchestrator, Pega's agents with Predictable AI, Flowable's agent engine, Nintex Agentic Business Orchestration, Bizagi AI Agents. Gartner's new BOAT category reflects this. Caution: Gartner also warns of "agent washing" and high cancellation rates ([Gartner](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027)).
2. **MCP is the integration standard for AI tools.** Anthropic donated MCP to the Agentic AI Foundation under the Linux Foundation in December 2025, co-founded with Block and OpenAI ([Anthropic](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)). Camunda, Pega, ServiceNow, Appian, Bizagi, IBM, Celonis, Microsoft, and n8n all ship MCP support, usually in both directions. Google's Agent2Agent protocol moved to the Linux Foundation in June 2025 ([Linux Foundation](https://linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents)).
3. **Process intelligence moves into execution.** Celonis added an Orchestration Engine and an MCP server; Appian Process HQ mines its own data; ServiceNow's AI Agent Advisor proposes fixes for lagging workflows. The direction is "find the bottleneck, then act on it in the same platform".
4. **Natural language to process model.** Pega Blueprint, UiPath Autopilot for Maestro, Mendix Maia for Workflows, Kissflow document-to-workflow, and ServiceNow's AI Build Agent all generate models from text. The model, not the prompt, remains the governed artifact.
5. **Pricing shifts to consumption and outcomes.** UiPath Platform Units (2025), ServiceNow assist pools and new tiers (2026), Temporal per-action pricing, Pega per-completed-case pricing for AI agents (2026). Buyers report difficulty forecasting cost.
6. **Licensing tightens, forks appear.** Camunda License 1.0 (2024), Camunda 7 CE end of life (October 2025) with Operaton and CIB seven forks, n8n fair-code. Permissive projects (Flowable OSS, Temporal, Kestra, Activepieces) gain attention.
7. **Durable execution and coding agents.** Temporal's valuation rose from $1.72B (March 2025) to a reported $5B (February 2026), and Temporal ties its growth to production agent workloads. UiPath Maestro Flow and Maestro Case explicitly support coding agents across build, test, and operate.
8. **Consolidation.** ProcessMaker and Decisions merged (November 2025); UiPath bought WorkFusion (February 2026). Mid-market BPM vendors are combining rules, IDP, and orchestration.
9. **Object-centric event data.** OCEL 2.0 (2023) and vendor "process graphs" or "digital twins" (Celonis PI Graph) replace single-case-ID event logs. This fits Throughline's object-centric model.

## 9. Standards and references

- BPMN 2.0.2, DMN, CMMN specifications: [OMG BPMN](https://www.omg.org/spec/BPMN/2.0.2/), [OMG DMN](https://www.omg.org/spec/DMN/), [OMG CMMN](https://www.omg.org/spec/CMMN/).
- Workflow Patterns Initiative: [control-flow](http://www.workflowpatterns.com/patterns/control/), [resource](http://www.workflowpatterns.com/patterns/resource/), [key papers](http://www.workflowpatterns.com/documentation/).
  - N. Russell, A.H.M. ter Hofstede, D. Edmond, W.M.P. van der Aalst. *Workflow Resource Patterns.* BETA Working Paper WP 127, Eindhoven University of Technology, 2004.
  - N. Russell, W.M.P. van der Aalst, A.H.M. ter Hofstede, D. Edmond. *Workflow Resource Patterns: Identification, Representation and Tool Support.* CAiSE 2005, LNCS 3520, pp. 216-232.
  - N. Russell, A.H.M. ter Hofstede, W.M.P. van der Aalst, N. Mulyar. *Workflow Control-Flow Patterns: A Revised View.* BPM Center Report BPM-06-22, 2006.
- Enterprise Integration Patterns, Scatter-Gather: [enterpriseintegrationpatterns.com](https://www.enterpriseintegrationpatterns.com/patterns/messaging/BroadcastAggregate.html).
- Object-centric event logs: [OCEL 2.0](https://www.ocel-standard.org).
- Open-source simulation and modeling building blocks: [Prosimos](https://pypi.org/project/prosimos), [Simod](https://simod.readthedocs.io), [bpmn-js-token-simulation](https://github.com/bpmn-io/bpmn-js-token-simulation).
- Model Context Protocol: [modelcontextprotocol.io](https://modelcontextprotocol.io/docs/learn); Agent2Agent: [Linux Foundation announcement](https://linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents).
