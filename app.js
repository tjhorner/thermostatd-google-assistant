const { smarthome } = require('actions-on-google')
const express = require('express')
const bodyParser = require('body-parser')
const FtoC = require('fahrenheit-to-celsius')
const CtoF = require('celsius-to-fahrenheit')
const { ThermostatdClient } = require('thermostatd')

const server = express()
server.use(bodyParser.json({ extended: true }))
server.use(bodyParser.urlencoded({ extended: true }))

const tsd = new ThermostatdClient(process.env.THERMOSTATD_HOST, process.env.THERMOSTATD_TOKEN)

const app = smarthome({
  key: process.env.GOOGLE_API_KEY
})

server.get("/auth", (req, res) => {
  res.redirect(`${req.query.redirect_uri}?state=${encodeURIComponent(req.query.state)}&code=thisisacode`)
})

server.post("/tok", (req, res) => {
  res.send({
    authorization_code: "code",
    access_code: "code",
    access_token: "code"
  })
})

const modeMap = [
  {
    tsd: "COOL",
    goog: "cool"
  },
  {
    tsd: "DRY",
    goog: "dry"
  },
  {
    tsd: "HEAT",
    goog: "heat"
  },
  {
    tsd: "FAN",
    goog: "fan-only"
  }
]

const getClosestEven = num => {
  const rnd = Math.round(num)
  return (rnd % 2 !== 0) ? rnd + 1 : rnd
}

const clamp = (num, min, max) => Math.min(Math.max(num, min), max)

const handleCommand = async command => {
  const response = {
    ids: [ "thermostatd" ],
    status: "SUCCESS"
  }

  const execution = command.execution[0]

  try {
    let newState
    switch(execution.command) {
      case "action.devices.commands.ThermostatSetMode":
        if(execution.params.thermostatMode === "off") {
          newState = await tsd.patchState({
            powered_on: false
          })
        } else if(execution.params.thermostatMode === "on") {
          newState = await tsd.patchState({
            powered_on: true
          })
        } else {
          newState = await tsd.patchState({
            current_mode: modeMap.find(m => m.goog === execution.params.thermostatMode).tsd,
            powered_on: true
          })
        }
        
        response.states = tsdStateToGoogState(newState)
        break
      case "action.devices.commands.ThermostatTemperatureSetpoint":
        const currState = await tsd.getState()
  
        let floor, ceil
        if(currState.current_mode === "HEAT")
          [ floor, ceil ] = [ 60, 76 ]
        else
          [ floor, ceil ] = [ 64, 88 ]
  
        newState = await tsd.patchState({
          target_temperature: getClosestEven(clamp(CtoF(execution.params.thermostatTemperatureSetpoint), floor, ceil))
        })
        response.states = tsdStateToGoogState(newState)
        break
      case "action.devices.commands.SetFanSpeed":
        newState = await tsd.patchState({
          fan_speed: execution.params.fanSpeed
        })
        response.states = tsdStateToGoogState(newState)
        break
    }
  } catch(e) {
    response.status = "ERROR"
    response.errorCode = "actionNotAvailable"
  }

  return response
}

app.onExecute(async (body, _) => {
  const commands = await Promise.all(body.inputs[0].payload.commands.map(c => handleCommand(c)))
  return {
    requestId: body.requestId,
    payload: { commands }
  }
})

const tsdStateToGoogState = state => ({
  online: true,
  thermostatMode: state.powered_on ? modeMap.find(m => m.tsd === state.current_mode).goog : "off",
  thermostatTemperatureSetpoint: FtoC(state.target_temperature),
  currentFanSpeedSetting: state.fan_speed
})

app.onQuery(async (body, _) => {
  const state = await tsd.getState()
  return {
    requestId: body.requestId,
    payload: {
      devices: {
        thermostatd: tsdStateToGoogState(state)
      }
    }
  }
})

app.onSync((body, headers) => {
  return {
    requestId: body.requestId,
    payload: {
      agentUserId: "1",
      devices: [
        {
          id: "thermostatd",
          type: "action.devices.types.THERMOSTAT",
          traits: [
            "action.devices.traits.TemperatureSetting",
            "action.devices.traits.FanSpeed"
          ],
          name: {
            defaultNames: [ "thermostatd" ],
            name: "Thermostat"
          },
          attributes: {
            availableThermostatModes: "on,off,cool,heat,dry,fan-only",
            thermostatTemperatureUnit: "F",
            availableFanSpeeds: {
              speeds: [
                {
                  speed_name: "AUTO",
                  speed_values: [
                    {
                      speed_synonym: [ "automatic" ],
                      lang: "en"
                    }
                  ]
                },
                {
                  speed_name: "QUIET",
                  speed_values: [
                    {
                      speed_synonym: [ "slowest" ],
                      lang: "en"
                    }
                  ]
                },
                {
                  speed_name: "LOW",
                  speed_values: [
                    {
                      speed_synonym: [ "low", "slow" ],
                      lang: "en"
                    }
                  ]
                },
                {
                  speed_name: "MEDIUM",
                  speed_values: [
                    {
                      speed_synonym: [ "low", "slow" ],
                      lang: "en"
                    }
                  ]
                },
                {
                  speed_name: "HIGH",
                  speed_values: [
                    {
                      speed_synonym: [ "high", "fast" ],
                      lang: "en"
                    }
                  ]
                }
              ],
              ordered: true
            },
            reversible: false
          }
        }
      ]
    }
  }
})

server.post("/action", app)
server.listen(process.env.PORT || 3000)