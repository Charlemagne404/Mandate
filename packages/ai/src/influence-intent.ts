import { InfluencePressure, InfluenceTerm } from '@mandate/schemas';
import type {
  InfluencePressure as InfluencePressureShape,
  InfluenceTerm as InfluenceTermShape,
  NationId,
  WorldState,
} from '@mandate/schemas';

const monthlyAmount = (text: string, treasury: number) => {
  const explicit =
    /\b(\d+)\s*(?:treasury units?|units?)\s*(?:per|a|each)\s*month\b/i.exec(
      text,
    );
  if (explicit) return Math.max(1, Number(explicit[1]));
  if (/\bmajor|large|substantial\b/i.test(text))
    return Math.max(1, Math.min(25, Math.floor(treasury * 0.05)));
  if (/\baffordable|modest|small\b/i.test(text))
    return Math.max(1, Math.min(5, Math.floor(treasury * 0.02)));
  return Math.max(1, Math.min(10, Math.floor(treasury * 0.03)));
};

/** Turn the player's negotiated sphere-of-influence intent into typed proposed clauses. */
export function influenceTermsFromText(
  world: WorldState,
  patronNationId: NationId,
  subjectNationId: NationId,
  text: string,
): InfluenceTermShape[] {
  const patron = world.nations.find((nation) => nation.id === patronNationId);
  const subject = world.nations.find((nation) => nation.id === subjectNationId);
  if (!patron || !subject) return [];
  const kinds = new Set<string>();
  const terms: InfluenceTermShape[] = [];
  const add = (
    kind: InfluenceTermShape['kind'],
    options: {
      amount?: number;
      ratePercent?: number;
      patron?: NationId;
      subject?: NationId;
    } = {},
  ) => {
    const termKey = `${kind}:${options.patron ?? patronNationId}:${options.subject ?? subjectNationId}`;
    if (kinds.has(termKey)) return;
    kinds.add(termKey);
    terms.push(
      InfluenceTerm.parse({
        kind,
        patronNationId: options.patron ?? patronNationId,
        subjectNationId: options.subject ?? subjectNationId,
        amount: options.amount ?? 0,
        ratePercent: options.ratePercent ?? 0,
      }),
    );
  };
  const treasury = patron.stats.treasury;
  const amount = monthlyAmount(text, treasury);
  const threatens = (channels: string) =>
    new RegExp(
      `\\b(?:cut|withdraw|suspend|cancel|terminate|end)\\b.{0,60}\\b(?:${channels})\\b`,
      'i',
    ).test(text);

  if (/\b(?:puppet|puppet state|full subject|subject state)\b/i.test(text)) {
    add('join-patron-wars');
    add('war-declaration-approval');
    add('no-war-against-patron');
    add('military-access');
    add('host-bases');
    add('military-planning');
    add('foreign-policy-veto');
    add('foreign-policy-alignment');
    add('no-rival-alliance');
    add('exclusive-market-access');
    add('customs-alignment');
  } else if (/\bprotectorate\b/i.test(text)) {
    add('security-guarantee');
    add('join-defensive-wars');
    add('military-access');
    add('foreign-policy-consultation');
    add('no-rival-alliance');
  } else if (
    /\bclient state\b|\bclient relationship\b|\bsubordinat/i.test(text)
  ) {
    add('security-guarantee');
    add('join-defensive-wars');
    add('foreign-policy-consultation');
    add('preferential-trade');
  }

  if (
    /\b(?:infrastructure|regional development|development fund|build.*(?:road|rail|port|grid))\b/i.test(
      text,
    ) &&
    !threatens('infrastructure|roads?|rail|ports?|development funding')
  )
    add('infrastructure-investment', { amount });
  if (
    /\b(?:preferential|preferred|priority)\s+access\b/i.test(text) &&
    !/\b(?:market|trade)\s+access\b/i.test(text)
  )
    add('preferential-trade');
  if (/\b(?:trade(?: and energy)?|economic) integration\b/i.test(text)) {
    add('preferential-trade');
    add('common-economic-rules');
  }
  if (
    /\b(?:subsid\w*|aid|financial support|development grant|support that .{1,60} can afford|affordable support)\b/i.test(
      text,
    ) &&
    !threatens('subsid\\w*|aid|financial support|development grant')
  )
    add('subsidy', { amount });
  if (/\b(?:loan|lend|credit line)\b/i.test(text))
    add('loan', {
      amount: Number(
        /\b(\d+)\s*(?:treasury units?|units?)\b/i.exec(text)?.[1] ?? amount,
      ),
    });
  if (
    /\b(?:pay(?:\s+off)?|assume|cover|forgive|relieve).{0,40}\bdebt\b|\bdebt relief\b/i.test(
      text,
    )
  ) {
    const debt = subject.stats.debt;
    const relief = Math.min(debt, patron.stats.treasury);
    if (relief > 0) add('debt-relief', { amount: relief });
  }
  if (/\b(?:debt repayment|repay.{0,30}debt|service.{0,20}debt)\b/i.test(text))
    add('debt-repayment', {
      amount: Math.max(
        1,
        Number(
          /\b(\d+)\s*(?:treasury units?|units?)\s*(?:per|a|each)\s*month\b/i.exec(
            text,
          )?.[1] ?? 1,
        ),
      ),
    });
  const tributePercent =
    /\b(\d{1,2})\s*%\s*(?:of\s+)?(?:government|state|public)?\s*revenue\b/i.exec(
      text,
    );
  if (
    /\b(?:tribute|remit|revenue share)\b|\bpay.{0,80}\b(?:to|for)\s+(?:us|the patron|nicaragua)\b/i.test(
      text,
    ) &&
    tributePercent
  )
    add('tribute', { ratePercent: Math.min(100, Number(tributePercent[1])) });
  else if (/\btribute\b/i.test(text)) {
    const tributeAmount =
      /\b(\d+)\s*(?:treasury units?|units?)\s*(?:per|a|each)\s*month\b/i.exec(
        text,
      );
    if (tributeAmount) add('tribute', { amount: Number(tributeAmount[1]) });
  }

  if (
    /\benergy|fuel|electricity supply\b/i.test(text) &&
    /\bdepend|supply|secure|provide|cooperat|integrat|support\b/i.test(text) &&
    !threatens('energy|fuel|electricity')
  )
    add('energy-supply', { amount });
  if (
    /\bpreferential|preferred|priority\b.{0,40}\b(?:market|trade) access\b/i.test(
      text,
    )
  ) {
    if (
      /\b(?:its|their|the)\s+market\b|\baccess to .{1,40} market\b/i.test(text)
    )
      add('market-access-concession');
    else add('preferential-trade');
  }
  if (/\bexclusive market|exclusive access\b/i.test(text))
    add('exclusive-market-access');
  if (/\bcustoms union|customs alignment|align customs\b/i.test(text))
    add('customs-alignment');
  if (
    /\bshared economic rules|common economic rules|harmonize economic\b/i.test(
      text,
    )
  )
    add('common-economic-rules');
  if (
    /\b(?:major\s+)?(?:economic|trade) agreements?\b.{0,55}\b(?:require|need|must have)\b.{0,35}\b(?:patron|our|my|nicaragua|me).{0,15}(?:approval|consent)\b|\b(?:without|subject to)\b.{0,20}\b(?:patron|our|my|nicaragua|me).{0,15}(?:approval|consent)\b.{0,35}\b(?:economic|trade) agreements?\b/i.test(
      text,
    )
  )
    add('economic-policy-approval');
  if (
    /\bmandatory procurement|buy exclusively|procurement preference\b/i.test(
      text,
    )
  )
    add('mandatory-procurement');
  if (
    /\bsecurity guarantee|guarantee.{0,30}(?:security|independence|protection)\b/i.test(
      text,
    )
  )
    add('security-guarantee');
  if (/\bsecurity (?:support|cooperation|assistance)\b/i.test(text))
    add('security-guarantee');
  if (/\bmilitary access\b/i.test(text)) add('military-access');
  if (
    /\b(?:base|basing) rights\b|host.{0,20}base\b|allow.{0,60}\b(?:aircraft|forces|troops|military)\b.{0,30}\b(?:use|access to)\b.{0,20}\bbases?\b/i.test(
      text,
    )
  )
    add('host-bases');
  if (
    /\bcoordinate.{0,25}military planning|joint military planning\b/i.test(text)
  )
    add('military-planning');
  if (
    /\bjoin.{0,30}defensive wars|\b(?:add(?:ing)?|include|including|require(?:ment)? to join).{0,30}defensive wars\b|mutual defense|mutual defence|defend(?:ive)? wars|support each other.{0,35}defensive wars\b/i.test(
      text,
    )
  ) {
    add('security-guarantee');
    add('join-defensive-wars');
    if (/\bmutual|each other|support each other\b/i.test(text)) {
      add('security-guarantee', {
        patron: subjectNationId,
        subject: patronNationId,
      });
      add('join-defensive-wars', {
        patron: subjectNationId,
        subject: patronNationId,
      });
    }
  }
  if (
    /\bjoin.{0,30}(?:all|our|patron(?:'s|’s)) wars\b|\b(?:client|organization|bloc) members?\b.{0,45}\bjoin.{0,20}war\b|\b(?:client|puppet|subject|protectorate) states?\b.{0,40}\bjoin.{0,20}(?:war|conflict)\b/i.test(
      text,
    )
  )
    add('join-patron-wars');
  if (
    /\b(?:cannot|can't|must not|may not|approval|required).{0,40}(?:declare|start).{0,20}war\b|\bnot\s+declar(?:e|ing).{0,20}war.{0,35}approval\b|\bwar declaration approval\b/i.test(
      text,
    )
  )
    add('war-declaration-approval');
  if (
    /\b(?:cannot|can't|must not|may not).{0,30}(?:attack|go to war against).{0,30}(?:patron|us|nicaragua)\b/i.test(
      text,
    )
  )
    add('no-war-against-patron');
  if (
    /\bconsult.{0,35}(?:patron|foreign[- ]policy|major treaty|alliance)|foreign[- ]policy consultation\b|consultation (?:on|before).{0,35}(?:treaty|alliance|foreign[- ]policy)\b|without consulting.{0,30}(?:us|patron|nicaragua)\b/i.test(
      text,
    )
  )
    add('foreign-policy-consultation');
  if (
    /\b(?:align|coordinate|follow|harmonize).{0,35}foreign[- ]policy\b|common.{0,30}foreign[- ]policy\b/i.test(
      text,
    )
  )
    add('foreign-policy-alignment');
  if (
    /\bcommon.{0,30}foreign[- ]policy\b|\bcoordinate.{0,30}foreign[- ]policy\b/i.test(
      text,
    )
  )
    add('foreign-policy-alignment', {
      patron: subjectNationId,
      subject: patronNationId,
    });
  if (
    /\b(?:veto|approval rights?).{0,35}(?:foreign|external|alliance|treaty)|(?:foreign|external)[- ]policy veto\b/i.test(
      text,
    )
  )
    add('foreign-policy-veto');
  if (
    /\b(?:cannot|can't|must not|may not|agree(?:s|ing)? not to).{0,45}(?:join|enter).{0,30}(?:rival|hostile|opposing)?\s*alliances?\b|no rival alliances\b|\b(?:leave|exit|withdraw from).{0,35}(?:rival\s+)?alliance\b/i.test(
      text,
    )
  )
    add('no-rival-alliance');
  if (
    /\bsupport.{0,35}(?:our|patron|nicaragua).{0,25}(?:diplomatic|international) initiatives\b/i.test(
      text,
    )
  )
    add('support-diplomatic-initiatives');
  if (
    /\bgovernment security arrangement|guarantee the government\b/i.test(text)
  )
    add('government-security-arrangement');

  return terms;
}

/** Parse one concrete, conditional withdrawal warning into bounded treaty pressure. */
export function conditionalPressureFromText(
  world: WorldState,
  patronNationId: NationId,
  subjectNationId: NationId,
  text: string,
): InfluencePressureShape | null {
  const condition =
    /\b(?:unless|if)\b.{0,120}\b(?:reject(?:s|ed)?|decline(?:s|d)?|refus(?:e|es|ed)|accept(?:s|ed)?|sign(?:s|ed)?|agree(?:s|d)?)\b/i.test(
      text,
    )
      ? 'rejection'
      : /\bif\b.{0,140}\b(?:join(?:s|ed)?|enter(?:s|ed)?|accept(?:s|ed)?|sign(?:s|ed)?)\b.{0,50}\b(?:rival\s+)?(?:alliance|bloc|security agreement|defen[cs]e pact)\b/i.test(
            text,
          )
        ? /\bsecurity agreement|defen[cs]e pact\b/i.test(text)
          ? 'accepts-rival-security'
          : 'joins-rival-alliance'
        : null;
  if (
    !condition ||
    !world.nations.some((nation) => nation.id === subjectNationId)
  )
    return null;

  const channel = /\benergy|fuel|electricity\b/i.test(text)
    ? 'energy'
    : /\binfrastructure|roads?|rail|ports?|power grid\b/i.test(text)
      ? 'infrastructure'
      : /\bmarket access|trade access|customs access|trade privileges\b/i.test(
            text,
          )
        ? 'market-access'
        : /\bsecurity guarantee|military protection|defense guarantee\b/i.test(
              text,
            )
          ? 'security-guarantee'
          : /\borganization|bloc|CAEU\b.{0,40}\bsubsid|\bsubsid.{0,40}\borganization/i.test(
                text,
              )
            ? 'organization-support'
            : /\baid|subsid|grant|financial support\b/i.test(text)
              ? 'aid'
              : null;
  if (!channel) return null;

  const action = /\b(?:withdraw|cut|cancel|terminate|end)\b/i.test(text)
    ? 'withdraw'
    : /\b(?:reduce|scale back|match)\b/i.test(text)
      ? 'reduce'
      : 'suspend';
  return InfluencePressure.parse({
    patronNationId,
    subjectNationId,
    condition,
    channel,
    action,
    severity:
      /\b(?:last chance|unless|will cut|will withdraw|threaten)\b/i.test(text)
        ? 45
        : 25,
    status: 'pending',
    createdDate: world.date,
  });
}

export function isInfluenceProposal(text: string) {
  return /\b(?:sphere of influence|political sphere|economically depend\w*|economic dependence|puppet|protectorate|client state|subject state|subordinat|dependency agreement|foreign[- ]policy veto|foreign[- ]policy consultation|economic policy approval|major economic agreements|(?:align|coordinate|harmonize).{0,35}foreign[- ]policy|political coordination|common.{0,30}foreign policy|coordinate.{0,35}foreign policy|vote with us|diplomatic position|military access|basing rights|economic integration|preferential market access|infrastructure investment|subsid\w*|\bloan\b|lend|credit line|debt relief|pay.{0,40}debt|security guarantee|join defensive wars|defensive wars|mutual defense|mutual defence|support each other|tribute|revenue share|no rival alliance|leave.{0,35}alliance|exit.{0,35}alliance|(?:all\s+)?our\s+(?:puppets|client states|protectorates)\s+pay|(?:client|puppet|subject|protectorate) states?.{0,40}join.{0,20}(?:war|conflict)|(?:threaten|warn|cut|withdraw|suspend).{0,50}(?:energy|fuel|electricity|subsid|aid|infrastructure|market access|security guarantee|organization support).{0,140}(?:unless|if))\b/i.test(
    text,
  );
}
