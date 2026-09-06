import { Platform } from "react-native";

export interface NetworkLink {
  label: string;
  appUrl: string;
  iosStoreUrl?: string;
  androidStoreUrl?: string;
  webUrl: string;
}

const NETWORK_MAP: Record<string, NetworkLink> = {
  chargepoint: {
    label: "ChargePoint",
    appUrl: "chargepoint://",
    iosStoreUrl: "https://apps.apple.com/us/app/chargepoint/id356866743",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.coulombtech",
    webUrl: "https://www.chargepoint.com/find-a-charger/",
  },
  evgo: {
    label: "EVgo",
    appUrl: "evgo://",
    iosStoreUrl: "https://apps.apple.com/us/app/evgo/id957673635",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.evgo.evgoapp",
    webUrl: "https://www.evgo.com/find-a-charger/",
  },
  blink: {
    label: "Blink",
    appUrl: "blink://",
    iosStoreUrl: "https://apps.apple.com/us/app/blink-charging/id1376014953",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.blinkcharging",
    webUrl: "https://www.blinkcharging.com/drivers/blink-network",
  },
  tesla: {
    label: "Tesla",
    appUrl: "tesla://",
    iosStoreUrl: "https://apps.apple.com/us/app/tesla/id582007913",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.teslamotors.tesla",
    webUrl: "https://www.tesla.com/findus/list/superchargers/",
  },
  supercharger: {
    label: "Tesla",
    appUrl: "tesla://",
    iosStoreUrl: "https://apps.apple.com/us/app/tesla/id582007913",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.teslamotors.tesla",
    webUrl: "https://www.tesla.com/findus/list/superchargers/",
  },
  tesla_supercharger: {
    label: "Tesla",
    appUrl: "tesla://",
    iosStoreUrl: "https://apps.apple.com/us/app/tesla/id582007913",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.teslamotors.tesla",
    webUrl: "https://www.tesla.com/findus/list/superchargers/",
  },
  tesla_motors: {
    label: "Tesla",
    appUrl: "tesla://",
    iosStoreUrl: "https://apps.apple.com/us/app/tesla/id582007913",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.teslamotors.tesla",
    webUrl: "https://www.tesla.com/findus/list/superchargers/",
  },
  electrify_america: {
    label: "Electrify America",
    appUrl: "electrifyamerica://",
    iosStoreUrl: "https://apps.apple.com/us/app/electrify-america/id1458030456",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.ea.evowner",
    webUrl: "https://www.electrifyamerica.com/locate-charger/",
  },
  electrifyamerica: {
    label: "Electrify America",
    appUrl: "electrifyamerica://",
    iosStoreUrl: "https://apps.apple.com/us/app/electrify-america/id1458030456",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.ea.evowner",
    webUrl: "https://www.electrifyamerica.com/locate-charger/",
  },
  volta: {
    label: "Volta",
    appUrl: "volta://",
    iosStoreUrl: "https://apps.apple.com/us/app/volta-charging/id1139836913",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.voltacharging.volta",
    webUrl: "https://www.voltacharging.com/",
  },
  flo: {
    label: "FLO",
    appUrl: "flo://",
    iosStoreUrl: "https://apps.apple.com/ca/app/flo-electric-vehicle-charging/id1229163482",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.flo.ev",
    webUrl: "https://flo.com/",
  },
  greenlots: {
    label: "Shell Recharge",
    appUrl: "shellrecharge://",
    iosStoreUrl: "https://apps.apple.com/gb/app/shell-recharge/id1516655946",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.greenlots.driver",
    webUrl: "https://shellrecharge.com/",
  },
  shell_recharge: {
    label: "Shell Recharge",
    appUrl: "shellrecharge://",
    iosStoreUrl: "https://apps.apple.com/gb/app/shell-recharge/id1516655946",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.greenlots.driver",
    webUrl: "https://shellrecharge.com/en/drivers/shell-recharge-locations",
  },
  shellrecharge: {
    label: "Shell Recharge",
    appUrl: "shellrecharge://",
    iosStoreUrl: "https://apps.apple.com/gb/app/shell-recharge/id1516655946",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.greenlots.driver",
    webUrl: "https://shellrecharge.com/en/drivers/shell-recharge-locations",
  },
  semacharge: {
    label: "SemaCharge",
    appUrl: "semacharge://",
    iosStoreUrl: "https://apps.apple.com/us/app/semaconnect/id881348985",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.semaconnect.driverapp",
    webUrl: "https://semacharge.com/",
  },
  semaconnect: {
    label: "SemaConnect",
    appUrl: "semaconnect://",
    iosStoreUrl: "https://apps.apple.com/us/app/semaconnect/id881348985",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.semaconnect.driverapp",
    webUrl: "https://semaconnect.com/",
  },
  ampup: {
    label: "AmpUp",
    appUrl: "ampup://",
    iosStoreUrl: "https://apps.apple.com/us/app/ampup/id1458065553",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=io.ampup.app",
    webUrl: "https://ampup.io/",
  },
  rivian: {
    label: "Rivian",
    appUrl: "rivian://",
    iosStoreUrl: "https://apps.apple.com/us/app/rivian/id1501628708",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.rivian.android",
    webUrl: "https://rivian.com/adventure-network",
  },
  ionna: {
    label: "Ionna",
    appUrl: "ionna://",
    iosStoreUrl: "https://apps.apple.com/us/app/ionna/id6448883957",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.ionna.driver",
    webUrl: "https://ionnacharging.com/",
  },
  clipper_creek: {
    label: "ClipperCreek",
    appUrl: "clippercreek://",
    iosStoreUrl: "https://apps.apple.com/us/app/clippercreek/id1234567890",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.clippercreek",
    webUrl: "https://www.clippercreek.com/",
  },
  webasto: {
    label: "Webasto",
    appUrl: "webasto://",
    iosStoreUrl: "https://apps.apple.com/app/webasto-charge-connect/id1489657994",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.webasto.chargeconnect",
    webUrl: "https://www.webasto.com/",
  },
  evcs: {
    label: "EVCS",
    appUrl: "evcs://",
    iosStoreUrl: "https://apps.apple.com/us/app/evcs/id1513831605",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.evcs.mobile",
    webUrl: "https://evcs.com/find-a-charger/",
  },
  opconnect: {
    label: "OpConnect",
    appUrl: "opconnect://",
    iosStoreUrl: "https://apps.apple.com/us/app/opconnect/id878789264",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.opconnect.android",
    webUrl: "https://opconnect.com/find-a-charger/",
  },
  circuit_electrique: {
    label: "Circuit électrique",
    appUrl: "circuitelectrique://",
    iosStoreUrl: "https://apps.apple.com/ca/app/circuit-%C3%A9lectrique/id689093361",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.hydroquebec.circuit",
    webUrl: "https://www.hydroquebec.com/circuit-electrique/",
  },
  le_circuit_electrique: {
    label: "Circuit électrique",
    appUrl: "circuitelectrique://",
    iosStoreUrl: "https://apps.apple.com/ca/app/circuit-%C3%A9lectrique/id689093361",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.hydroquebec.circuit",
    webUrl: "https://www.hydroquebec.com/circuit-electrique/",
  },
  circuit__lectrique: {
    label: "Circuit électrique",
    appUrl: "circuitelectrique://",
    iosStoreUrl: "https://apps.apple.com/ca/app/circuit-%C3%A9lectrique/id689093361",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.hydroquebec.circuit",
    webUrl: "https://www.hydroquebec.com/circuit-electrique/",
  },
  le_circuit__lectrique: {
    label: "Circuit électrique",
    appUrl: "circuitelectrique://",
    iosStoreUrl: "https://apps.apple.com/ca/app/circuit-%C3%A9lectrique/id689093361",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.hydroquebec.circuit",
    webUrl: "https://www.hydroquebec.com/circuit-electrique/",
  },
  swtch_energy: {
    label: "SWTCH Energy",
    appUrl: "swtch://",
    iosStoreUrl: "https://apps.apple.com/ca/app/swtch/id1458648847",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.swtchenergy.driver",
    webUrl: "https://swtchenergy.com/find-a-charger/",
  },
  nrg_energy: {
    label: "NRG Energy",
    appUrl: "nrg://",
    iosStoreUrl: "https://apps.apple.com/us/app/nrg-evgo/id957673635",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.nrg.app",
    webUrl: "https://www.nrg.com/",
  },
  evbox: {
    label: "EVBox",
    appUrl: "evbox://",
    iosStoreUrl: "https://apps.apple.com/nl/app/evbox/id1441791481",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.evbox.driver",
    webUrl: "https://evbox.com/en/find-a-charger",
  },
  everon: {
    label: "Everon",
    appUrl: "everon://",
    iosStoreUrl: "https://apps.apple.com/app/everon/id1592920027",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.everon.app",
    webUrl: "https://everon.io/find-a-charger/",
  },
  allego: {
    label: "Allego",
    appUrl: "allego://",
    iosStoreUrl: "https://apps.apple.com/nl/app/allego/id1444793388",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=eu.allego.app",
    webUrl: "https://www.allego.eu/en-gb/drivers/find-a-charge-point",
  },
  greenway: {
    label: "GreenWay",
    appUrl: "greenway://",
    iosStoreUrl: "https://apps.apple.com/sk/app/greenway/id1373040165",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=eu.greenwayinfrastructure.driver",
    webUrl: "https://greenwayinfrastructure.com/map/",
  },
  greenway_infrastructure: {
    label: "GreenWay",
    appUrl: "greenway://",
    iosStoreUrl: "https://apps.apple.com/sk/app/greenway/id1373040165",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=eu.greenwayinfrastructure.driver",
    webUrl: "https://greenwayinfrastructure.com/map/",
  },
  chargefox: {
    label: "Chargefox",
    appUrl: "chargefox://",
    iosStoreUrl: "https://apps.apple.com/au/app/chargefox/id1388607816",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=au.com.chargefox",
    webUrl: "https://www.chargefox.com/charging-stations/",
  },
  fastned: {
    label: "Fastned",
    appUrl: "fastned://",
    iosStoreUrl: "https://apps.apple.com/nl/app/fastned/id905510745",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=nl.fastned.android",
    webUrl: "https://fastnedcharging.com/en/stations/",
  },
  evie_networks: {
    label: "Evie Networks",
    appUrl: "evienetworks://",
    iosStoreUrl: "https://apps.apple.com/au/app/evie-networks/id1550038234",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=au.com.evienetworks",
    webUrl: "https://www.evienetworks.com.au/find-a-charger/",
  },
  evienetworks: {
    label: "Evie Networks",
    appUrl: "evienetworks://",
    iosStoreUrl: "https://apps.apple.com/au/app/evie-networks/id1550038234",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=au.com.evienetworks",
    webUrl: "https://www.evienetworks.com.au/find-a-charger/",
  },
  pod_point: {
    label: "Pod Point",
    appUrl: "podpoint://",
    iosStoreUrl: "https://apps.apple.com/gb/app/pod-point/id878399825",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=net.podpoint.android",
    webUrl: "https://pod-point.com/public-charging",
  },
  podpoint: {
    label: "Pod Point",
    appUrl: "podpoint://",
    iosStoreUrl: "https://apps.apple.com/gb/app/pod-point/id878399825",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=net.podpoint.android",
    webUrl: "https://pod-point.com/public-charging",
  },
  newmotion: {
    label: "NewMotion",
    appUrl: "newmotion://",
    iosStoreUrl: "https://apps.apple.com/nl/app/newmotion/id739671710",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.newmotion.app",
    webUrl: "https://newmotion.com/en/charge/charge-outside/public-charging-locations/",
  },
  ionity: {
    label: "IONITY",
    appUrl: "ionity://",
    iosStoreUrl: "https://apps.apple.com/de/app/ionity/id1447341386",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=eu.ionity.app",
    webUrl: "https://ionity.eu/en/charging-stations",
  },
  enbw: {
    label: "EnBW",
    appUrl: "enbwmobility://",
    iosStoreUrl: "https://apps.apple.com/de/app/enbw-mobility/id1229163482",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=de.enbw.mobility",
    webUrl: "https://www.enbw.com/electromobility/charging-stations",
  },
  enbw_mobility: {
    label: "EnBW mobility+",
    appUrl: "enbwmobility://",
    iosStoreUrl: "https://apps.apple.com/de/app/enbw-mobility/id1229163482",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=de.enbw.mobility",
    webUrl: "https://www.enbw.com/electromobility/charging-stations",
  },
  bp_pulse: {
    label: "bp pulse",
    appUrl: "bppulse://",
    iosStoreUrl: "https://apps.apple.com/gb/app/bp-pulse/id1516655946",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.bppulse.app",
    webUrl: "https://www.bppulse.co.uk/find-a-charger",
  },
  aral_pulse: {
    label: "Aral Pulse",
    appUrl: "aralpulse://",
    iosStoreUrl: "https://apps.apple.com/de/app/aral-pulse/id1562082143",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=de.aral.pulse",
    webUrl: "https://www.aral.de/de/fuer-unterwegs/aral-pulse/ladestation-finden.html",
  },
  aral: {
    label: "Aral Pulse",
    appUrl: "aralpulse://",
    iosStoreUrl: "https://apps.apple.com/de/app/aral-pulse/id1562082143",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=de.aral.pulse",
    webUrl: "https://www.aral.de/de/fuer-unterwegs/aral-pulse/ladestation-finden.html",
  },
  mer: {
    label: "Mer",
    appUrl: "mereco://",
    iosStoreUrl: "https://apps.apple.com/app/mer/id1476025484",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=eco.mer.app",
    webUrl: "https://mer.eco/find-a-charger",
  },
  fortum_charge_and_drive: {
    label: "Mer",
    appUrl: "mereco://",
    iosStoreUrl: "https://apps.apple.com/app/mer/id1476025484",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=eco.mer.app",
    webUrl: "https://mer.eco/find-a-charger",
  },
  incharge: {
    label: "InCharge",
    appUrl: "incharge://",
    iosStoreUrl: "https://apps.apple.com/se/app/incharge/id1200148028",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.vattenfall.incharge",
    webUrl: "https://incharge.vattenfall.com/find-charge-point",
  },
  vattenfall_incharge: {
    label: "InCharge",
    appUrl: "incharge://",
    iosStoreUrl: "https://apps.apple.com/se/app/incharge/id1200148028",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.vattenfall.incharge",
    webUrl: "https://incharge.vattenfall.com/find-charge-point",
  },
  clever: {
    label: "Clever",
    appUrl: "clever://",
    iosStoreUrl: "https://apps.apple.com/dk/app/clever/id1490741388",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=dk.clever.app",
    webUrl: "https://clever.dk/lad-op/ladestationer",
  },
  plugsurfing: {
    label: "Plugsurfing",
    appUrl: "plugsurfing://",
    iosStoreUrl: "https://apps.apple.com/de/app/plugsurfing/id592007920",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.plugsurfing.plugsurfing",
    webUrl: "https://plugsurfing.com/map",
  },
  circle_k: {
    label: "Circle K",
    appUrl: "circlek://",
    iosStoreUrl: "https://apps.apple.com/app/circle-k/id1059664850",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.circlek.app",
    webUrl: "https://www.circlek.com/recharge",
  },
  recharge: {
    label: "Recharge",
    appUrl: "rechargeinfra://",
    iosStoreUrl: "https://apps.apple.com/app/recharge/id1562082143",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.rechargeinfra.app",
    webUrl: "https://rechargeinfra.com/find-charger",
  },
  enel_x: {
    label: "Enel X Way",
    appUrl: "enelxway://",
    iosStoreUrl: "https://apps.apple.com/us/app/enel-x-way/id1467000024",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.enelx.way",
    webUrl: "https://www.enelxway.com/charging-stations",
  },
  enel_x_way: {
    label: "Enel X Way",
    appUrl: "enelxway://",
    iosStoreUrl: "https://apps.apple.com/us/app/enel-x-way/id1467000024",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.enelx.way",
    webUrl: "https://www.enelxway.com/charging-stations",
  },
  eon_drive: {
    label: "E.ON Drive",
    appUrl: "eondrive://",
    iosStoreUrl: "https://apps.apple.com/de/app/e-on-drive/id1432423773",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.eon.drive",
    webUrl: "https://www.eon.com/drive/charging-stations",
  },
  e_on_drive: {
    label: "E.ON Drive",
    appUrl: "eondrive://",
    iosStoreUrl: "https://apps.apple.com/de/app/e-on-drive/id1432423773",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.eon.drive",
    webUrl: "https://www.eon.com/drive/charging-stations",
  },
  gridserve: {
    label: "GRIDSERVE",
    appUrl: "gridserve://",
    iosStoreUrl: "https://apps.apple.com/gb/app/gridserve/id1566155900",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.gridserve.app",
    webUrl: "https://gridserve.com/electric-forecourts/",
  },
  osprey: {
    label: "Osprey",
    appUrl: "ospreycharging://",
    iosStoreUrl: "https://apps.apple.com/gb/app/osprey-charging/id1573462468",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=uk.ospreycharging.app",
    webUrl: "https://ospreycharging.co.uk/our-network",
  },
  osprey_charging: {
    label: "Osprey",
    appUrl: "ospreycharging://",
    iosStoreUrl: "https://apps.apple.com/gb/app/osprey-charging/id1573462468",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=uk.ospreycharging.app",
    webUrl: "https://ospreycharging.co.uk/our-network",
  },
  charge_amps: {
    label: "Charge Amps",
    appUrl: "chargeamps://",
    iosStoreUrl: "https://apps.apple.com/se/app/charge-amps/id1098729060",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.chargeamps.app",
    webUrl: "https://chargeamps.com/find-a-charger",
  },

  // Blink variants
  blink_charging: {
    label: "Blink",
    appUrl: "blink://",
    iosStoreUrl: "https://apps.apple.com/us/app/blink-charging/id1376014953",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.blinkcharging",
    webUrl: "https://www.blinkcharging.com/drivers/blink-network",
  },

  // Shell Recharge variants
  shell_recharge_solutions: {
    label: "Shell Recharge",
    appUrl: "shellrecharge://",
    iosStoreUrl: "https://apps.apple.com/gb/app/shell-recharge/id1516655946",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.greenlots.driver",
    webUrl: "https://shellrecharge.com/en/drivers/shell-recharge-locations",
  },

  // Rivian variants
  rivian_waypoints: {
    label: "Rivian",
    appUrl: "rivian://",
    iosStoreUrl: "https://apps.apple.com/us/app/rivian/id1501628708",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.rivian.android",
    webUrl: "https://rivian.com/adventure-network",
  },
  rivian_adventure_network: {
    label: "Rivian",
    appUrl: "rivian://",
    iosStoreUrl: "https://apps.apple.com/us/app/rivian/id1501628708",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.rivian.android",
    webUrl: "https://rivian.com/adventure-network",
  },

  // EV Connect
  ev_connect: {
    label: "EV Connect",
    appUrl: "evconnect://",
    iosStoreUrl: "https://apps.apple.com/us/app/ev-connect/id891187814",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.evconnect.evconnect",
    webUrl: "https://www.evconnect.com/find-a-charger",
  },
  evconnect: {
    label: "EV Connect",
    appUrl: "evconnect://",
    iosStoreUrl: "https://apps.apple.com/us/app/ev-connect/id891187814",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.evconnect.evconnect",
    webUrl: "https://www.evconnect.com/find-a-charger",
  },

  // EVoke
  evoke: {
    label: "EVoke",
    appUrl: "evoke://",
    iosStoreUrl: "https://apps.apple.com/us/app/evoke-charging/id1551613593",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.evoke.app",
    webUrl: "https://www.evoke.net/find-a-charger",
  },

  // Electrify America variants
  electrify_america_2: {
    label: "Electrify America",
    appUrl: "electrifyamerica://",
    iosStoreUrl: "https://apps.apple.com/us/app/electrify-america/id1458030456",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.ea.evowner",
    webUrl: "https://www.electrifyamerica.com/locate-charger/",
  },

  // EVgo variants (handles "eVgo" casing)
  e_vgo: {
    label: "EVgo",
    appUrl: "evgo://",
    iosStoreUrl: "https://apps.apple.com/us/app/evgo/id957673635",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.evgo.evgoapp",
    webUrl: "https://www.evgo.com/find-a-charger/",
  },

  // ChargePoint variants
  chargepoint_network: {
    label: "ChargePoint",
    appUrl: "chargepoint://",
    iosStoreUrl: "https://apps.apple.com/us/app/chargepoint/id356866743",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.coulombtech",
    webUrl: "https://www.chargepoint.com/find-a-charger/",
  },
};

export function getNetworkLink(network: string | null | undefined): NetworkLink | null {
  if (!network) return null;
  const key = network
    .toLowerCase()
    .replace(/[\s\-éèê]/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  return NETWORK_MAP[key] ?? null;
}

/**
 * Opens the native mobile app for the given network.
 *
 * Priority order:
 *   1. Native deep-link (e.g. chargepoint://) — opens app directly if installed
 *   2. Platform-specific App Store / Play Store page — lets user install the app
 *   3. Website fallback — always works
 */
export function openNetworkApp(
  network: string,
  Linking: { openURL: (url: string) => Promise<unknown> }
): void {
  const link = getNetworkLink(network);
  if (!link) return;

  const storeUrl =
    Platform.OS === "ios"
      ? link.iosStoreUrl
      : Platform.OS === "android"
      ? link.androidStoreUrl
      : undefined;

  const isDeepLink = !/^https?:\/\//.test(link.appUrl);

  if (isDeepLink) {
    Linking.openURL(link.appUrl)
      .catch(() =>
        storeUrl
          ? Linking.openURL(storeUrl).catch(() => Linking.openURL(link.webUrl))
          : Linking.openURL(link.webUrl)
      );
  } else if (storeUrl) {
    Linking.openURL(storeUrl).catch(() => Linking.openURL(link.webUrl));
  } else {
    Linking.openURL(link.webUrl);
  }
}
