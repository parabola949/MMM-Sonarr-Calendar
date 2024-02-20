/* global Log, Module, moment, config */
/* Magic Mirror
 * Module: MMM-Sonarr-Calendar
 *
 * By Stephen Cotton
 * MIT Licensed.
 */

//var Module, Log, moment, config, Log, moment, document;

Module.register("MMM-Sonarr-Calendar", {

     // Default module config.
    defaults: {
        sonarrProtocol: "http",
        sonarrHost: "localhost",
        sonarrPort: "8989",
        sonarrAPIKey: "",

        totalDays: 3,
        scrollTimeout: 10000,
        scrollEffect: 'scrollHorz',

        updateInterval: 5 * 60 * 1000,

        debug: false,
    },

    components: {
        models: {},
        views: {},    
        collections: {},
    },

    models: [],
    updateViews: [],
    updatesCollection: null,
    mainView: null,

    updater: null,
    lastUpdate: 0,

    suspend: function(){
        this.stopUpdateTimer();
        if( this.mainView !== null ){
            this.mainView.trigger("stopSlider");
        }
    },
    resume: function(){
        this.startUpdateTimer();
        if( this.mainView !== null ){
            this.mainView.trigger("startSlider");
        }
    },

    // Subclass start method.
    start: function () {
        Log.info("Starting module: " + this.name);
        if (this.config.debug) Log.info(this.name + " config: ", this.config);

        var self = this;
        
        this.setupModels();
        this.setupViews();

        self.getLatestCalendar();

        this.startUpdateTimer();

    },

    startUpdateTimer: function(){
        var self = this;
        if( moment().valueOf() - this.lastUpdate > this.config.updateInterval ){
            this.getLatestCalendar();
        }
        this.updater = setInterval(function(){
            self.getLatestCalendar();
        }, this.config.updateInterval );
    },

    stopUpdateTimer: function(){
        clearInterval(this.updater);
    },

    setupModels: function(){
        this.components.models.update = Backbone.Model.extend({
            defaults: {
                seriesName        : "",
                seString          : "",
                episodeName       : "",
                episodeDescription: "",
                seriesPoster      : "",
                episodeDate       : "",
                id                : 0
            },
            initialize: function(){

            }
        });
    },

    setupViews: function(){
        var self = this;
        this.components.views.singleUpdate = Backbone.View.extend({
            tagName: "div",
            className: "single-calendar",
            template: MMMSonarrCalendar.Templates.slide,
            initialize: function(){},
            render: function(){
                return this.template( this.model.toJSON() );
            }
        });
        this.components.collections.updates = Backbone.Collection.extend({
            model: self.components.models.update
        })
        this.components.views.updateSlider = Backbone.View.extend({
            tagName: "div",
            className: 'cycle-slideshow episode-slideshow',
            template: MMMSonarrCalendar.Templates.main,
            attributes: function(){
                return {
                    'data-cycle-fx' : self.config.scrollEffect,
                    'data-cycle-timeout': self.config.scrollTimeout,
                    'data-cycle-slides': "> div",
                    //'data-cycle-paused': "true",
                }
            },
            initialize: function(){
                var that = this;
                this.updateViews = [];

                this.collection.each(function(update){
                    that.updateViews.push( new self.components.views.singleUpdate({
                        model: update
                    }));
                });
                this.on("startSlider", this.startSlider, this);
                this.on("stopSlider", this.stopSlider, this);
            },
            render: function(){
                this.$el.on('error','img',function(e){
                    console.error(e);
                    $(e.target).attr('src', self.file("images/no-image.png"));
                });
                var that = this;
                this.$el.empty()
                _(this.updateViews).each(function(updateView){
                    that.$el.append( updateView.render() );
                });

                this.$el.cycle({
                    fx: self.config.scrollEffect,
                    timeout: self.config.scrollTimeout,
                    slides: "> div"
                });
                return this;
            },
            startSlider: function(){
                this.$el.cycle('resume');
            },
            stopSlider: function(){
                this.$el.cycle('pause');
            }
        });
    },

    getScripts: function() {
        return [
            'moment.js',
            'https://code.jquery.com/jquery-2.2.3.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/underscore.js/1.8.3/underscore-min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/backbone.js/1.3.3/backbone-min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/handlebars.js/4.0.6/handlebars.runtime.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/jquery.cycle2/2.1.6/jquery.cycle2.min.js',
            this.file('templates.js')
        ];
    },

    getStyles: function() {
        return [
            this.file('css/main.css')
        ];
    },

    // Subclass socketNotificationReceived method.
    socketNotificationReceived: function (notification, payload) {
        if (this.config.debug) Log.info("Sonarr Calendar ::  Received Notification: " + notification, payload);
        var self = this;
    },

    buildApiUrl: function(){
        return this.config.sonarrProtocol + "://" + this.config.sonarrHost + ':' + this.config.sonarrPort 
        + '/api/v3/calendar?apikey=' + this.config.sonarrAPIKey
		+ '&includeSeries=true'
        + '&start=' + moment().format('YYYY-MM-DD') 
        + '&end=' + moment().add(this.config.totalDays,'days').format('YYYY-MM-DD');
    },


    getLatestCalendar: function(){
        if (this.config.debug) Log.info('Sonarr Calendar :: Refreshing Calendar');
        this.refreshCalendar();
    },

    refreshCalendar: function(){
        var latestCalendar;
        latestCalendar = [];
        var self = this;

        var CalendarRequest = new XMLHttpRequest();
        CalendarRequest.open("GET", this.buildApiUrl(), true);
        CalendarRequest.onreadystatechange = function() {
            if (this.readyState === 4) {
                if (this.status === 200) {
                    self.lastUpdate = moment().valueOf();
                    self.processCalendar(JSON.parse(this.response));
                } 
            }
        };
        CalendarRequest.send();
    },

    processCalendar: function(data){
        if( this.config.debug) Log.info( 'Sonarr Calendar :: Received Data', data );
        
        this.models = [];

        for( var record_i in data ){
            if( this.config.debug ) Log.info( 'Sonarr Calendar :: Processing Single Data Record', data[record_i] );
            var thisDataRecord = data[ record_i ];
            var processedData = this.processCalendarRecord( thisDataRecord );
            if( this.config.debug ) Log.info('Sonarr Calendar :: Processed Data', processedData);
            var newUpdateRecord = new this.components.models.update( processedData );
            this.models.push( newUpdateRecord );
        }
        this.updateDom();
        //this.sendSocketNotification("Calendar_LOADED", data);
    },

    processCalendarRecord: function(record){
        todayDate = moment();
        airDate = moment(record.airDateUtc);
        /*if( todayDate.format('YYYY-MM-DD') == airDate.format('YYYY-MM-DD') ) dateString = 'Today';
        else if ()*/
        return {
            seriesName        : record.series.title,
            seString          : "S" + this.formatSENumber( record.seasonNumber ) + 'E' + this.formatSENumber( record.episodeNumber ),
            episodeName       : record.title,
            episodeDescription: record.series.overview,
            seriesPoster      : this.getSeriesPoster( record.series.images ),
            episodeDate       : airDate.calendar(),
            id                : record.id
        };
    },

    formatSENumber: function(number){
        return number < 10 ? '0' + number : number;
    },

    getSeriesPoster: function(images){
        for(var image in images){
            if (image.coverType == 'banner'){
                return image.remoteUrl;
            }
        }
    },

    // Override dom generator.
    getDom: function () {
        var wrapper, self;

        var updatesCollection = new this.components.collections.updates( this.models );
        var updatesView = new this.components.views.updateSlider({
            collection: updatesCollection
        });

        return updatesView.render().el;

    },
});